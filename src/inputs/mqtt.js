import { getConnection } from "../util/connections.js";
import MqttTopics from "mqtt-topics";
import Input from "../util/generic-input.js";

export default class MQTT extends Input {
  constructor(config, task) {
    super(config, task);
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

  async handleMessage(message) {
    if (this.next) this.next.handleMessage(message);
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
  "disabled": false,
  "topics": [],
  "transformations": [],
  "destinations": []
}
*/
