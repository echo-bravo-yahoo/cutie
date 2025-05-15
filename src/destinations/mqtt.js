import mqtt from "mqtt";

import { Destination } from "../util/generic-destination.js";

export default class MQTT extends Destination {
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
  "metadata": {
    "island": "<node>",
    "timestamp": "2024-11-19T04:59:43.405Z"
  },
  "temp": 76.52394317895174,
  "humidity": 28.606149841897132,
  "pressure": 1003.3289466281659
  "dimensions": {
    "island": "<node>",
    "location": "office"
  }
}
*/
