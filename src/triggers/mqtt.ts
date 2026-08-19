import { getConnection } from "../util/connections.js";
import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import MQTTConnection from "../connections/mqtt.js";
import { ModuleSchema } from "../util/schema.js";

export interface MQTTConfig extends TriggerConfig {
  connectionName: string;
  // `topic` is accepted in a config and normalized onto `topics` before a
  // module ever sees it, so only the plural form exists here.
  topics: Array<string>;
}

export function isMQTT(trigger: Trigger): trigger is MQTT {
  return !!trigger && Array.isArray((trigger as unknown as MQTT).config.topics);
}

export default class MQTT extends Trigger {
  declare config: MQTTConfig;
  // @ts-expect-error mqtt is instantiated by enable()
  mqtt: MQTTConnection;

  constructor(config: MQTTConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async enable() {
    this.mqtt = getConnection(
      this.config.connectionName,
    ) as unknown as MQTTConnection;

    if (this.config.topics.length) {
      await this.mqtt.subscribe(this.config.topics);

      this.info(
        `Started listening to MQTT topics ${this.config.topics.join(", ")} using client ${this.mqtt.connection.options.clientId}.`,
      );
    }
    this.enabled = true;
  }

  async disable() {
    await this.mqtt.unsubscribe(this.config.topics);

    this.info(
      `Stopped listening to MQTT topics ${this.config.topics.join(", ")} using client ${this.mqtt.connection.options.clientId}.`,
    );
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:mqtt",
  description:
    "Starts a message for every MQTT message published to one of its topics.",
  options: {
    connectionName: {
      type: "string",
      description: "Which declared connection to subscribe on.",
      required: true,
    },
    topics: {
      type: "array",
      description:
        'Topic filters to subscribe to, MQTT wildcards included, such as "alarms/+".',
      required: true,
    },
  },
};
