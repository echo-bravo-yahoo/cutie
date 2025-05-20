import mqtt from "mqtt";

import { Exchange } from "../util/generic-exchange.js";

export default class MQTT extends Exchange {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.config.enabled) {
      return this.enable();
    }
  }

  async enable() {
    this.connection = mqtt.connect(this.config.endpoint, {
      ...this.config,
      name: undefined,
      type: undefined,
      enabled: undefined,
      endpoint: undefined,
    });
  }

  async send(measurementName, event, labels, aggregationMetadata) {
    this.connection.publish(
      measurementName,
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
