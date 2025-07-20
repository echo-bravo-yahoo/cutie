import { getConnection } from "../util/connections.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import MQTTConnection from "../connections/mqtt.js";
import { Message } from "../util/type-helpers.js";

export interface MQTTConfig extends OutputConfig {
  topics: Array<string>;
  connectionName: string;
}

export default class MQTT extends Output {
  declare config: MQTTConfig;
  mqtt?: MQTTConnection;

  constructor(config: MQTTConfig, task: Task) {
    super(config, task);
  }

  async enable() {
    this.mqtt = getConnection(this.config.connectionName) as MQTTConnection;
    this.enabled = true;
  }

  async disable() {
    this.mqtt = undefined;
    this.enabled = false;
  }

  async send(message: Message) {
    this.config.topics.forEach((topic) => {
      const interpolatedTopic = this.interpolateConfigString(topic, {
        message,
      });

      this.mqtt?.sendRaw(interpolatedTopic, JSON.stringify(message));
    });

    return typeof message !== "string" ? JSON.stringify(message) : message;
  }
}

/*
{
  "type": "output:mqtt:personal-mqtt",
  "disabled": false,
  "topic": "data/weather/${state.location}"
}
*/
