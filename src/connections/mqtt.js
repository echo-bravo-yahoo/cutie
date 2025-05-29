import mqtt from "mqtt";

import { Connection } from "../util/generic-connection.js";
import { getConnectionsByType } from "../util/connections.js";
import { globals } from "../index.js";

export default class MQTT extends Connection {
  constructor(config) {
    super(config);

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
    this.connection = mqtt.connect(this.config.endpoint, {
      ...this.config,
      name: undefined,
      type: undefined,
      enabled: undefined,
      endpoint: undefined,
    });

    this.connection.on("message", this.handleMessage.bind(this));
  }

  handleMessage(topic, message, _packet) {
    message = JSON.parse(message.toString());
    this.debug(
      { role: "blob", blob: message },
      `Received new message on topic "${topic}": ${JSON.stringify(message)}`
    );
    const mqttConnectionNames = getConnectionsByType("mqtt").map(
      (connection) => connection.config.name
    );
    const triggers = globals.modules.filter((module) => {
      return mqttConnectionNames.includes(module.config.name);
    });
    this.debug(`Found ${triggers.length} matching triggers.`);
    for (let triggerModule of triggers) {
      if (triggerModule.matchesTopic(topic))
        triggerModule.handleMessage(message);
    }
  }

  async subscribe(topics) {
    return this.connection.subscribeAsync(topics);
  }

  sendRaw(topic, message) {
    return this.connection.publish(topic, message);
  }

  send(topic, event, labels, aggregationMetadata) {
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
