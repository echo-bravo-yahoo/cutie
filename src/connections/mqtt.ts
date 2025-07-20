import mqtt from "mqtt";
import MqttTopics from "mqtt-topics";

import { Connection, ConnectionConfig } from "../util/Connection.js";
import { getConnectionsByType } from "../util/connections.js";
import { globals } from "../index.js";
import MQTT, { isMQTT } from "../inputs/mqtt.js";

export interface MQTTConnectionConfig
  extends ConnectionConfig,
    mqtt.IClientOptions {
  endpoint: string;
  type: string;
  enabled: boolean;
}

export default class MQTTConnection extends Connection {
  declare config: MQTTConnectionConfig;
  // @ts-expect-error connection is instantiated by enable()
  connection: mqtt.MqttClient;

  constructor(config: MQTTConnectionConfig) {
    super(config);
  }

  async enable() {
    const mqttConfig: Partial<typeof this.config> = { ...this.config };
    delete mqttConfig.name;
    delete mqttConfig.type;
    delete mqttConfig.enabled;
    delete mqttConfig.endpoint;

    this.connection = mqtt.connect(this.config.endpoint, mqttConfig);

    this.connection.on("message", this.handleMessage.bind(this));
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
      const firstStep = globals.tasks[i].steps[0];
      if (!isMQTT(firstStep)) continue;
      const desiredConnection = firstStep.config.connectionName;

      if (mqttConnectionNames.includes(desiredConnection)) {
        if (
          isMQTT(firstStep) &&
          MQTTConnection.matchesTopic(
            topic,
            firstStep.config.topic || firstStep.config.topics || "",
          )
        ) {
          (globals.tasks[i].steps[0] as unknown as MQTT).startMessage(message);
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
