import { getConnection } from "../util/connections.js";
import MqttTopics from "mqtt-topics";
import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";
import MQTTConnection from "../connections/mqtt.js";
import Step from "../util/Step.js";

export interface MQTTConfig extends InputConfig {
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

export default class MQTT extends Input {
  declare config: MQTTConfig;
  // @ts-expect-error mqtt is instantiated by enable()
  mqtt: MQTTConnection;

  constructor(config: MQTTConfig, task: Task) {
    super(config, task);
  }

  async enable() {
    this.mqtt = getConnection(this.name) as unknown as MQTTConnection;

    if (
      this.config.topic ||
      (this.config.topics && this.config.topics.length)
    ) {
      await this.mqtt.subscribe(this.config.topic || this.config.topics || []);

      this.info(
        `Started listening to MQTT topics ${this.config.topic || (this.config.topics || []).join(", ")}.`,
        { topic: this.logPrefix },
      );
    }
    this.enabled = true;
  }

  async disable() {
    // BUG: double subscriptions, single unsubscribe will break
    // the other subscriber
    await this.mqtt.unsubscribe(this.config.topic || this.config.topics || []);

    this.info(
      `Stopped listening to MQTT topics ${this.config.topic || (this.config.topics || []).join(", ")}.`,
      { topic: this.logPrefix },
    );
    this.enabled = false;
  }

  // TODO: dupe of inputs/mqtt.js:::matchesTopic
  matchesTopic(messageTopic: string) {
    if (this.config.topic) {
      return MqttTopics.match(this.config.topic, messageTopic);
    }

    return (this.config.topics || []).some((topic) =>
      MqttTopics.match(topic, messageTopic),
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
