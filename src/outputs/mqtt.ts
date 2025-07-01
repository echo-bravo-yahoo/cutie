import MqttTopics from "mqtt-topics";

import { getConnection } from "../util/connections.js";
import Output, { OutputConfig } from "../util/generic-output.js";
import Task from "../util/generic-task.js";
import MQTTConnection from "../connections/mqtt.js";

export interface MQTTConfig extends OutputConfig {
  topics: Array<string>;
}

export default class MQTT extends Output {
  config: MQTTConfig;
  mqtt?: MQTTConnection;

  constructor(config: MQTTConfig, task: Task) {
    super(config, task);
  }

  async register() {
    if (!this.config.disabled && !this.task.disabled) {
      return this.enable();
    }
  }

  async enable() {
    this.mqtt = getConnection(this.name);
    this.enabled = true;
  }

  async disable() {
    this.mqtt = undefined;
    this.enabled = false;
  }

  async send(message: any) {
    this.config.topics.forEach((topic) => {
      const interpolatedTopic = this.interpolateConfigString(topic, {
        message,
      });
      // console.log(
      //   `Sending message to topic "${interpolatedTopic}":\n${JSON.stringify(message, null, 2)}`
      // );
      this.mqtt &&
        this.mqtt.sendRaw(interpolatedTopic, JSON.stringify(message));
    });
  }

  // TODO: dupe of inputs/mqtt.js:::matchesTopic
  matchesTopic(messageTopic: string) {
    // if (this.config.topic) {
    //   return MqttTopics.match(topic, messageTopic);
    // }

    return this.config.topics.some((topic) =>
      MqttTopics.match(topic, messageTopic)
    );
  }
}

/*
{
  "type": "output:mqtt:personal-mqtt",
  "disabled": false,
  "topic": "data/weather/${state.location}"
}
*/
