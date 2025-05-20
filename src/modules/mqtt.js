import { Module } from "../util/generic-module.js";
import { getExchange } from "../util/exchanges.js";
import MqttTopics from "mqtt-topics";

export class MQTT extends Module {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.config.enabled) {
      this.enable();
    }
  }

  async enable() {
    this.mqtt = getExchange(this.stateKey);
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
    message = await this.transform(message);

    for (let destination of this.config.destinations) {
      const exchange = getExchange(destination.name);
      this.debug(
        { role: "blob", blob: message },
        `Dispatching on topic "${destination.measurement}" for exchange "${exchange.config.name}": ${JSON.stringify(message)}`
      );
      exchange.sendRaw(destination.measurement, JSON.stringify(message));
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

export default MQTT;
