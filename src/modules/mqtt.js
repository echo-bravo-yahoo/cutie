import { Module } from "../util/generic-module.js";
import { getConnection } from "../util/connections.js";
import MqttTopics from "mqtt-topics";

export default class MQTT extends Module {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.config.enabled) {
      this.enable();
    }
  }

  async enable() {
    this.mqtt = getConnection(this.stateKey);
    if (this.config.topics && this.config.topics.length) {
      await this.mqtt.subscribe(this.config.topics);

      this.info(
        {},
        `Started listening to MQTT topics ${this.config.topics.join(", ")}.`
      );
    }
    this.enabled = true;
  }

  async disable() {
    // BUG: double subscriptions, single unsubscribe will break
    // the other subscriber
    await this.mqtt.unsubscribe(this.config.topics);

    this.info(
      {},
      `Stopped listening to MQTT topics ${this.config.topics.join(", ")}.`
    );
    this.enabled = false;
  }

  async dispatch(message) {
    message = await this.runAllTransformations(message);

    for (let destination of this.config.destinations) {
      const connection = getConnection(destination.name);
      this.debug(
        { role: "blob", blob: message },
        `Dispatching on topic "${destination.topic}" for connection "${connection.config.name}": ${JSON.stringify(message)}`
      );
      connection.sendRaw(destination.topic, JSON.stringify(message));
    }
  }

  matchesTopic(messageTopic) {
    return this.config.topics.some((topic) =>
      MqttTopics.match(topic, messageTopic)
    );
  }
}

/*
{
  "type": "mqtt",
  "enabled": true,
  "topics": [],
  "transformations": [],
  "destinations": []
}
*/
