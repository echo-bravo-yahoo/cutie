import mqtt from "mqtt";
import MqttTopics from "mqtt-topics";

import { Connection, ConnectionConfig } from "../util/Connection.js";
import { getConnectionsByType } from "../util/connections.js";
import { globals } from "../index.js";
import MQTT, { isMQTT } from "../triggers/mqtt.js";
import { ProviderConfig } from "../util/type-helpers.js";
import { ConfigFile } from "../util/configs.js";

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
  connection: mqtt.MqttClient;

  constructor(config: MQTTConnectionConfig) {
    super(config);
  }

  async uploadConfig(topic: string, config: ConfigFile) {
    this.connection = await mqtt.connectAsync(
      this.config.endpoint,
      this.config,
    );

    await this.connection.publishAsync(topic, JSON.stringify(config, null, 4), {
      retain: true,
    });
  }

  async fetchAllConfigs(): Promise<Record<string, ConfigFile>> {
    const configs: Record<string, ConfigFile> = {};
    this.connection.subscribe(`cutie/config/+`);

    this.connection.on("message", (topic, message) => {
      const nodeName = topic.split("/").pop();
      if (nodeName) configs[nodeName] = JSON.parse(message.toString());
    });

    return new Promise((resolve) =>
      setTimeout(async () => {
        resolve(configs);
      }, 100),
    );
  }

  async uploadSingleConfig(nodeName: string, config: ConfigFile) {
    return this.connection.publishAsync(
      `cutie/config/${nodeName}`,
      JSON.stringify(config),
      { retain: true },
    );
  }

  async fetchSingleConfig(nodeName: string): Promise<ConfigFile> {
    this.connection.subscribe(`cutie/config/${nodeName}`);

    return new Promise((resolve) => {
      this.connection.on("message", (topic, message) => {
        if (topic === `cutie/config/${nodeName}`) {
          resolve(JSON.parse(message.toString()));
        }
      });
    });
  }

  // TODO: update config if remote config _changes_
  // TODO: update _local_ config if _local_ config changes
  async fetchConfig(
    provider: MQTTProviderConfig,
    connection: ConnectionConfig,
  ): Promise<ConfigFile> {
    const typedConnection = connection as unknown as MQTTConnectionConfig;
    this.connection = await mqtt.connectAsync(
      typedConnection.endpoint,
      typedConnection,
    );
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
          await this.connection.endAsync();
          globals.logger.info(
            `Fetched remote config from MQTT topic ${provider.topic} using client ${this.connection.options.clientId}. Cleaning up.`,
            { topic: this.logPrefix, config },
          );
          // @ts-expect-error connection is instantiated by register()
          this.connection = undefined;
          globals.connections = [];
          resolve(config);
        }
      });
    });
  }

  async disable(): Promise<void> {
    globals.connections = [];
    return new Promise((resolve) => {
      this.connection.end(true, {}, () => console.log("res", resolve()));
      // @ts-expect-error connection is instantiated by register()
      delete this.connection;
    });
  }

  async register() {
    const mqttConfig: Partial<typeof this.config> = { ...this.config };
    delete mqttConfig.name;
    delete mqttConfig.type;
    delete mqttConfig.enabled;
    delete mqttConfig.endpoint;

    this.connection = mqtt.connect(this.config.endpoint, mqttConfig);

    this.connection.on("message", this.handleMessage.bind(this));
    this.enabled = true;
  }

  handleMessage(topic: string, message: Buffer, _packet: mqtt.IPublishPacket) {
    message = JSON.parse(message.toString());
    this.debug(
      `Received new message on topic "${topic}".}`,
      { topic: this.logPrefix },
      { message },
    );
    const mqttConnectionNames = getConnectionsByType("mqtt").map(
      (connection) => connection.name,
    );
    let triggers = 0;

    for (let i = 0; i < globals.tasks.length; i++) {
      const trigger = globals.tasks[i].trigger;
      if (!trigger || !isMQTT(trigger)) continue;
      const desiredConnection = trigger.config.connectionName;

      if (mqttConnectionNames.includes(desiredConnection)) {
        if (
          isMQTT(trigger) &&
          MQTTConnection.matchesTopic(
            topic,
            trigger.config.topic || trigger.config.topics || "",
          )
        ) {
          (globals.tasks[i].steps[0] as unknown as MQTT).handleMessage(message);
          triggers++;
        }
      }
    }

    this.debug(`Found ${triggers} matching triggers.`, {
      topic: this.logPrefix,
    });
  }

  async subscribe(
    topics: Parameters<typeof this.connection.subscribeAsync>[0],
  ) {
    if (this.enabled) return this.connection.subscribeAsync(topics);
  }

  async unsubscribe(
    topics: Parameters<typeof this.connection.unsubscribeAsync>[0],
  ) {
    return this.connection.unsubscribeAsync(topics);
  }

  sendRaw(
    topic: Parameters<typeof this.connection.publish>[0],
    message: Parameters<typeof this.connection.publish>[1],
  ) {
    return this.connection.publish(topic, message);
  }

  send(
    topic: Parameters<typeof this.connection.publish>[0],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
    labels: Array<string>,
  ) {
    return this.connection.publish(
      topic,
      JSON.stringify({
        ...event,
        metadata: labels,
      }),
    );
  }

  static matchesTopic(
    topicToMatch: string,
    possibleMatches: Array<string> | string,
  ) {
    if (typeof possibleMatches === "string")
      return MqttTopics.match(topicToMatch, possibleMatches);

    return possibleMatches.some((topic) =>
      MqttTopics.match(topic, topicToMatch),
    );
  }
}

/*
{
  "name": "mqtt",
  "type": "mqtt",
  "enabled": true,
  "username": "",
  "password": "",
  "endpoint": "mqtt://127.0.0.1:1883"
}

{
  "name": "mqtt",
  "topic": "data/weather/${state.location || 'unknown'}"
}
*/
