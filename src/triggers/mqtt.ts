import { getConnection } from "../util/connections.js";
import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import MQTTConnection from "../connections/mqtt.js";
import Step from "../util/Step.js";

export interface MQTTConfig extends TriggerConfig {
  connectionName: string;
  topic: string;
  topics?: Array<string>;
}

export function isMQTT(step: Step): step is MQTT {
  const hasTopicOrTopics =
    typeof (step as unknown as MQTT).config.topic === "string" ||
    (step as unknown as MQTT).config.topics?.length !== undefined;

  return step && hasTopicOrTopics;
}

export default class MQTT extends Trigger {
  declare config: MQTTConfig;
  // @ts-expect-error mqtt is instantiated by enable()
  mqtt: MQTTConnection;

  constructor(config: MQTTConfig, task: Task) {
    super(config, task);
  }

  async enable() {
    this.mqtt = getConnection(
      this.config.connectionName,
    ) as unknown as MQTTConnection;

    if (
      this.config.topic ||
      (this.config.topics && this.config.topics.length)
    ) {
      await this.mqtt.subscribe(this.config.topic || this.config.topics || []);

      this.info(
        `Started listening to MQTT topics ${this.config.topic || (this.config.topics || []).join(", ")} using client ${this.mqtt.connection.options.clientId}.`,
        { topic: this.logPrefix },
      );
    }
    this.enabled = true;
  }

  async disable() {
    await this.mqtt.unsubscribe(this.config.topic || this.config.topics || []);

    this.info(
      `Stopped listening to MQTT topics ${this.config.topic || (this.config.topics || []).join(", ")} using client ${this.mqtt.connection.options.clientId}.`,
      { topic: this.logPrefix },
    );
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:mqtt",
  "disabled": false,
  "connectionName": "personal-mqtt",
  "topics": ["alarms/+"]
}
*/
