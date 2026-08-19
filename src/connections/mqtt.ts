import mqtt from "mqtt";
import MqttTopics from "mqtt-topics";

import {
  ConfigProvider,
  Connection,
  ConnectionConfig,
} from "../util/Connection.js";
import { globals } from "../index.js";
import { isMQTT } from "../triggers/mqtt.js";
import { Message, ProviderConfig } from "../util/type-helpers.js";
import { ConfigFile } from "../util/configs.js";
import { redact } from "../util/redact.js";
import { ModuleSchema } from "../util/schema.js";
import { fromTraceparent, newTraceId } from "../util/trace.js";

export const DEFAULT_CONFIG_TOPIC = "cutie/config/+";
const DEFAULT_COLLECT_MS = 100;
const DEFAULT_FETCH_TIMEOUT_MS = 10000;

// A config topic doubles as a subscribe filter and a publish target, so a "+"
// segment stands in for the node name. One --topic value therefore works for
// every subcommand: "a/b/+" subscribes as-is and publishes to "a/b/<node>".
function topicForNode(topic: string, nodeName: string) {
  return topic.includes("+") ? topic.replace("+", nodeName) : topic;
}

export interface MQTTConnectionConfig
  extends ConnectionConfig,
    mqtt.IClientOptions {
  endpoint: string;
  type: string;
}

export interface MQTTProviderConfig extends ProviderConfig {
  topic: string;
}

export default class MQTTConnection
  extends Connection
  implements ConfigProvider
{
  declare config: MQTTConnectionConfig;
  // @ts-expect-error this will be instantiated by enabling (before it's accessed)
  connection: mqtt.MqttClient;

  // One MQTT connection is shared by every trigger on it, so a topic may have
  // several subscribers. Only unsubscribe when the last one goes away.
  subscriberCounts: Map<string, number> = new Map();

  constructor(config: MQTTConnectionConfig) {
    super(config);
  }

  async fetchAllConfigs(
    topic: string = DEFAULT_CONFIG_TOPIC,
    waitMs: number = DEFAULT_COLLECT_MS,
  ): Promise<Record<string, ConfigFile>> {
    const configs: Record<string, ConfigFile> = {};
    const handler = (messageTopic: string, message: Buffer) => {
      const nodeName = messageTopic.split("/").pop();
      if (nodeName) configs[nodeName] = JSON.parse(message.toString());
    };

    this.connection.on("message", handler);
    await this.connection.subscribeAsync(topic);

    return new Promise((resolve) =>
      setTimeout(() => {
        this.connection.removeListener("message", handler);
        resolve(configs);
      }, waitMs),
    );
  }

  async uploadSingleConfig(
    nodeName: string,
    config: ConfigFile,
    topic: string = DEFAULT_CONFIG_TOPIC,
  ) {
    return this.connection.publishAsync(
      topicForNode(topic, nodeName),
      JSON.stringify(config),
      { retain: true },
    );
  }

  async fetchSingleConfig(
    nodeName: string,
    topic: string = DEFAULT_CONFIG_TOPIC,
    timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ): Promise<ConfigFile> {
    const nodeTopic = topicForNode(topic, nodeName);
    await this.connection.subscribeAsync(nodeTopic);

    let handler: (topic: string, message: Buffer) => void = () => {};
    let timer: NodeJS.Timeout | undefined;

    try {
      return await new Promise<ConfigFile>((resolve, reject) => {
        handler = (messageTopic: string, message: Buffer) => {
          if (messageTopic === nodeTopic)
            resolve(JSON.parse(message.toString()));
        };
        this.connection.on("message", handler);

        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${timeoutMs}ms waiting for a retained config message on MQTT topic "${nodeTopic}".`,
              ),
            ),
          timeoutMs,
        );
      });
    } finally {
      if (timer) clearTimeout(timer);
      this.connection.removeListener("message", handler);
    }
  }

  // TODO: update config if remote config _changes_
  // TODO: update _local_ config if _local_ config changes
  async fetchConfig(
    provider: MQTTProviderConfig,
    _connection: ConnectionConfig,
    timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ): Promise<ConfigFile> {
    // register() already opened a client; opening a second one here used to
    // overwrite it, leaking the first socket for the life of the process
    globals.logger.info(
      `Fetching remote config from MQTT topic "${provider.topic}" using client ${this.connection.options.clientId}.`,
    );
    await this.connection.subscribeAsync(provider.topic);

    let handler: (topic: string, message: Buffer) => void = () => {};
    let timer: NodeJS.Timeout | undefined;

    // Every exit has to be a settled promise. Without the timeout and the two
    // rejections, a node whose config topic holds nothing -- or holds something
    // that is not JSON -- waited here forever and the cached copy was never
    // reached.
    try {
      const config = await new Promise<ConfigFile>((resolve, reject) => {
        handler = (messageTopic: string, message: Buffer) => {
          if (messageTopic !== provider.topic) return;

          try {
            resolve(JSON.parse(message.toString()) as ConfigFile);
          } catch (error) {
            reject(
              new Error(
                `The retained message on MQTT topic "${provider.topic}" is not valid JSON: ${(error as Error).message}.`,
              ),
            );
          }
        };
        this.connection.on("message", handler);

        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${timeoutMs}ms waiting for a retained config message on MQTT topic "${provider.topic}".`,
              ),
            ),
          timeoutMs,
        );
      });

      globals.logger.info(
        `Fetched remote config from MQTT topic "${provider.topic}". Cleaning up.`,
        { topic: this.logPrefix, config: redact(config) },
      );

      return config;
    } finally {
      if (timer) clearTimeout(timer);
      this.connection.removeListener("message", handler);
      // the bootstrap client has done its job either way
      await this.disable();
    }
  }

  async disable(): Promise<void> {
    // fetchConfig ends and clears the client itself, so this has to tolerate
    // being called on a connection that is already closed
    if (!this.connection) return;

    await this.connection.endAsync();
    // @ts-expect-error connection is instantiated by register()
    this.connection = undefined;
    this.enabled = false;
  }

  async register() {
    // Everything left over is handed to the mqtt client, so an option this
    // schema does not document still reaches it.
    const mqttConfig: Partial<typeof this.config> = { ...this.config };
    delete mqttConfig.name;
    delete mqttConfig.type;
    delete mqttConfig.endpoint;
    delete mqttConfig.disabled;

    // subscribe() gates on this.enabled, so the client has to have finished
    // connecting before enabled flips -- otherwise an early subscribe races it.
    this.connection = await mqtt.connectAsync(this.config.endpoint, mqttConfig);
    this.connection.on("message", this.handleMessage.bind(this));
    this.enabled = true;
  }

  handleMessage(topic: string, raw: Buffer, packet: mqtt.IPublishPacket) {
    const text = raw.toString();
    let message: Message;

    try {
      message = JSON.parse(text);
    } catch {
      // not every publisher sends JSON, and an unparseable retained message
      // used to take the whole process down through the uncaughtException path
      message = text;
    }

    // Every trigger this message matches shares one trace, because the line
    // below is logged once and can only carry one ID; the fan-out shows up
    // inside that trace. A publisher that sent a traceparent continues its own.
    const header = packet?.properties?.userProperties?.traceparent;
    const traceId =
      fromTraceparent(Array.isArray(header) ? header[0] : (header ?? "")) ??
      newTraceId();

    this.debug(
      `Received new message on topic "${topic}".`,
      { traceId },
      { message },
    );
    let triggers = 0;

    for (let i = 0; i < globals.tasks.length; i++) {
      const trigger = globals.tasks[i].trigger;
      if (!trigger || !isMQTT(trigger)) continue;
      // The topic stays subscribed while any other trigger still wants it, so
      // a disabled trigger has to be skipped here rather than at the broker.
      if (!trigger.enabled) continue;
      // This connection's own name, not the set of every MQTT connection's:
      // with two brokers the latter fires triggers bound to the other one.
      if (trigger.config.connectionName !== this.config.name) continue;

      if (MQTTConnection.matchesTopic(topic, trigger.config.topics)) {
        // Going through the trigger rather than steps[0] tolerates a task
        // with no steps.
        trigger.startMessage(message, traceId);
        triggers++;
      }
    }

    this.debug(`Found ${triggers} matching triggers.`, { traceId });
  }

  async subscribe(
    topics: Parameters<typeof this.connection.subscribeAsync>[0],
  ) {
    if (!this.enabled) return;
    const list = Array.isArray(topics) ? topics : [topics as string];
    const fresh = list.filter((topic) => {
      const count = this.subscriberCounts.get(topic) ?? 0;
      this.subscriberCounts.set(topic, count + 1);
      return count === 0;
    });

    if (fresh.length) return this.connection.subscribeAsync(fresh);
  }

  async unsubscribe(
    topics: Parameters<typeof this.connection.unsubscribeAsync>[0],
  ) {
    const list = Array.isArray(topics) ? topics : [topics as string];
    const done = list.filter((topic) => {
      const count = (this.subscriberCounts.get(topic) ?? 1) - 1;
      this.subscriberCounts.set(topic, Math.max(0, count));
      return count <= 0;
    });

    if (done.length) return this.connection.unsubscribeAsync(done);
  }

  // publishAsync, not publish: the caller awaits this, and the callback form
  // resolves before the broker has been told anything.
  sendRaw(
    topic: Parameters<typeof this.connection.publishAsync>[0],
    message: Parameters<typeof this.connection.publishAsync>[1],
    options?: mqtt.IClientPublishOptions,
  ) {
    // register() may have failed to connect and torn the client down, so
    // this has to tolerate being called with no client rather than throwing
    // on every message a task tries to send while disconnected.
    if (!this.connection) {
      this.debug(
        `Dropped a publish to "${topic}"; connection "${this.name}" never connected.`,
      );
      return;
    }

    // publishAsync, not publish: the caller awaits this, and the callback form
    // resolves before the broker has been told anything.
    return this.connection.publishAsync(topic, message, options ?? {});
  }

  static matchesTopic(
    topicToMatch: string,
    possibleMatches: Array<string> | string,
  ) {
    // MqttTopics.match takes (filter, topic) in that order.
    const filters =
      typeof possibleMatches === "string" ? [possibleMatches] : possibleMatches;

    return filters.some((filter) => MqttTopics.match(filter, topicToMatch));
  }
}

// Anything this schema does not name is still forwarded to the mqtt client by
// register(), so a rarely-used client option keeps working; it just reports as
// an unknown option, which is a warning rather than an error.
export const schema: ModuleSchema = {
  type: "connection:mqtt",
  description:
    "A connection to an MQTT broker, shared by every trigger and output that names it.",
  options: {
    endpoint: {
      type: "string",
      description:
        'The broker to connect to, such as "mqtt://127.0.0.1:1883". Credentials belong in username and password rather than in the URL.',
      required: true,
    },
    username: {
      type: "string",
      description:
        "The username to authenticate with, when the broker wants one.",
    },
    password: {
      type: "string",
      description:
        "The password to authenticate with, when the broker wants one.",
    },
    clientId: {
      type: "string",
      description:
        "The client identifier to present to the broker. Defaults to a generated one.",
    },
    keepalive: {
      type: "number",
      description:
        "How long the broker should wait before considering this client gone.",
      unit: "s",
      min: 0,
    },
    reconnectPeriod: {
      type: "number",
      description: "How long to wait before retrying a dropped connection.",
      unit: "ms",
      min: 0,
    },
    connectTimeout: {
      type: "number",
      description: "How long to wait for the broker to accept a connection.",
      unit: "ms",
      min: 0,
    },
    clean: {
      type: "boolean",
      description:
        "Start a fresh session rather than resuming the one this client id left behind.",
    },
    rejectUnauthorized: {
      type: "boolean",
      description:
        "For a TLS endpoint, refuse a certificate that does not verify.",
    },
  },
};
