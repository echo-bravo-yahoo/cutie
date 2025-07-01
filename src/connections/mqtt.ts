import mqtt from "mqtt";

import { Connection, ConnectionConfig } from "../util/generic-connection.js";
import { getConnectionsByType } from "../util/connections.js";
import { globals } from "../index.js";
import Task from "../util/generic-task.js";
import { Globals } from "../util/generic-loggable.js";

export interface MQTTConnectionConfig
  extends ConnectionConfig,
    mqtt.IClientOptions {
  endpoint: string;
  name: string;
  type: string;
  enabled: boolean;
}

export default class MQTTConnection extends Connection {
  config: MQTTConnectionConfig;
  state: { subscriptions: Array<any> };
  connection: mqtt.MqttClient;

  constructor(config: MQTTConnectionConfig, task: Task) {
    super(config, task);

    this.state = {
      subscriptions: [],
    };
  }

  async register() {
    if (!this.config.disabled) {
      return this.enable();
    }
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
      { role: "blob", blob: message },
      `Received new message on topic "${topic}": ${JSON.stringify(message)}`
    );
    const mqttConnectionNames = getConnectionsByType("mqtt").map(
      (connection) => connection.name
    );
    let triggers = 0;

    for (let i = 0; i < (globals as Globals).tasks.length; i++) {
      const desiredConnection = (globals as Globals).tasks[
        i
      ].steps[0].config.type.split(":")[2];

      if (mqttConnectionNames.includes(desiredConnection)) {
        if (
          (globals as Globals).tasks[i].steps[0].matchesTopic &&
          (globals as Globals).tasks[i].steps[0].matchesTopic(topic)
        ) {
          (globals as Globals).tasks[i].steps[0].handleMessage(message);
          triggers++;
        }
      }
    }

    this.debug(`Found ${triggers} matching triggers.`);
  }

  async subscribe(
    topics: Parameters<typeof this.connection.subscribeAsync>[0]
  ) {
    return this.connection.subscribeAsync(topics);
  }

  async unsubscribe(
    topics: Parameters<typeof this.connection.unsubscribeAsync>[0]
  ) {
    return this.connection.unsubscribeAsync(topics);
  }

  sendRaw(
    topic: Parameters<typeof this.connection.publish>[0],
    message: Parameters<typeof this.connection.publish>[1]
  ) {
    return this.connection.publish(topic, message);
  }

  send(
    topic: Parameters<typeof this.connection.publish>[0],
    event: any,
    labels: Array<string>,
    aggregationMetadata: any
  ) {
    return this.connection.publish(
      topic,
      JSON.stringify({
        ...event,
        metadata: labels,
        aggregationMetadata: aggregationMetadata,
      })
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
