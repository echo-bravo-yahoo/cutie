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
    // TODO: interpolation goes here
    this.mqtt.sendRaw(this.config.topic, JSON.stringify(message));
  }
}

/*
{
  "type": "output:mqtt:personal-mqtt",
  "disabled": false,
  "topic": "data/weather/${state.location}"
}
*/
