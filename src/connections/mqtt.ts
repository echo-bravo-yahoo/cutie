import mqtt from "mqtt";
import MqttTopics from "mqtt-topics";

import { Connection, ConnectionConfig } from "../util/Connection.js";
import { getConnectionsByType } from "../util/connections.js";
import { globals } from "../index.js";
import { isMQTT } from "../triggers/mqtt.js";
import { Message, ProviderConfig } from "../util/type-helpers.js";
import { ConfigFile } from "../util/configs.js";
import { redact } from "../util/redact.js";
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
  enabled: boolean;
}

export interface MQTTProviderConfig extends ProviderConfig {
  topic: string;
}

export default class MQTTConnection extends Connection {
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
          if (messageTopic === nodeTopic) resolve(JSON.parse(message.toString()));
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
  ): Promise<ConfigFile> {
    // register() already opened a client; opening a second one here used to
    // overwrite it, leaking the first socket for the life of the process
    console.log(
      `Fetching remote config from MQTT topic ${provider.topic} using client ${this.connection.options.clientId}.`,
    );
    this.connection.subscribe(provider.topic);

    return new Promise((resolve, _reject) => {
      this.connection.on("message", async (topic, message) => {
        if (topic === provider.topic) {
          const config = JSON.parse(
            message.toString(),
          ) as unknown as ConfigFile;
          const clientId = this.connection.options.clientId;
          await this.connection.endAsync();
          globals.logger.info(
            `Fetched remote config from MQTT topic ${provider.topic} using client ${clientId}. Cleaning up.`,
            { topic: this.logPrefix, config: redact(config) },
          );
          // @ts-expect-error connection is instantiated by register()
          this.connection = undefined;
          this.enabled = false;
          resolve(config);
        }
      });
    });
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
    const mqttConfig: Partial<typeof this.config> = { ...this.config };
    delete mqttConfig.name;
    delete mqttConfig.type;
    delete mqttConfig.enabled;
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
      { topic: this.logPrefix, traceId },
      { message },
    );
    const mqttConnectionNames = getConnectionsByType("mqtt").map(
      (connection) => connection.name,
    );
    let triggers = 0;

    for (let i = 0; i < globals.tasks.length; i++) {
      const trigger = globals.tasks[i].trigger;
      if (!trigger || !isMQTT(trigger)) continue;
      // The topic stays subscribed while any other trigger still wants it, so
      // a disabled trigger has to be skipped here rather than at the broker.
      if (!trigger.enabled) continue;
      const desiredConnection = trigger.config.connectionName;

      if (mqttConnectionNames.includes(desiredConnection)) {
        if (
          MQTTConnection.matchesTopic(
            topic,
            trigger.config.topic || trigger.config.topics || "",
          )
        ) {
          // Going through the trigger rather than steps[0] tolerates a task
          // with no steps.
          trigger.startMessage(message, traceId);
          triggers++;
        }
      }
    }

    this.debug(`Found ${triggers} matching triggers.`, {
      topic: this.logPrefix,
      traceId,
    });
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

  sendRaw(
    topic: Parameters<typeof this.connection.publish>[0],
    message: Parameters<typeof this.connection.publish>[1],
    options?: mqtt.IClientPublishOptions,
  ) {
    return this.connection.publish(topic, message, options);
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

/*
{
  "name": "personal-mqtt",
  "type": "connection:mqtt",
  "disabled": false,
  "username": "",
  "password": "",
  "endpoint": "mqtt://127.0.0.1:1883"
}
*/
