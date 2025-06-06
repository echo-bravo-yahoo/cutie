import MqttTopics from "mqtt-topics";

import { getConnection } from "../util/connections.js";
import Output from "../util/generic-output.js";

export default class MQTT extends Output {
  constructor(config, task) {
    super(config, task);
  }

  async register() {
    if (!this.config.disabled && !this.task.disabled) {
      this.enable();
    }
  }

  async enable() {
    this.mqtt = getConnection(this.name);
    this.enabled = true;
  }

  async disable() {
    // BUG: double subscriptions, single unsubscribe will break
    // the other subscriber
    await this.mqtt.unsubscribe(this.config.topics);
    this.mqtt = undefined;

    this.info(
      {},
      `Stopped listening to MQTT topics ${this.config.topics.join(", ")}.`
    );
    this.enabled = false;
  }

  async send(message) {
    const interpolatedTopic = this.interpolateConfigString(this.config.topic);
    // console.log(
    //   `Sending message to topic "${interpolatedTopic}":\n${JSON.stringify(message, null, 2)}`
    // );
    this.mqtt.sendRaw(interpolatedTopic, JSON.stringify(message));
  }

  // TODO: dupe of inputs/mqtt.js:::matchesTopic
  matchesTopic(messageTopic) {
    if (this.config.topic) {
      return MqttTopics.match(topic, messageTopic);
    }

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
