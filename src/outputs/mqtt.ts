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
    await Promise.all(
      this.config.topics.map((topic) =>
        this.mqtt?.sendRaw(
          this.interpolateConfigString(topic, { message }),
          JSON.stringify(message),
        ),
      ),
    );

    return message;
  }
}

/*
{
  "type": "output:mqtt",
  "disabled": false,
  "connectionName": "personal-mqtt",
  "topics": ["data/weather/${stash.location}"]
}
*/
