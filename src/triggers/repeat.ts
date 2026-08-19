import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { cloneMessage } from "../util/Step.js";
import { parseDuration } from "../util/duration.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface RepeatConfig extends TriggerConfig {
  interval: number | string;
  message: Message;
}

export default class Repeat extends Trigger {
  declare config: RepeatConfig;
  // @ts-expect-error repeat is instantiated by enable()
  repeat: NodeJS.Timeout;
  intervalMs = 0;

  constructor(config: RepeatConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // An interval of zero or less makes setInterval spin as fast as the event
  // loop allows, which is a busy loop rather than a schedule.
  async register() {
    this.intervalMs = parseDuration(this.config.interval, "interval");

    if (this.intervalMs <= 0)
      throw new Error(
        `Task "${this.task.name}": "trigger:repeat" needs a positive "interval", but found ${JSON.stringify(this.config.interval)}.`,
      );
  }

  async enable() {
    this.repeat = setInterval(() => {
      // Cloned before interpolation so a transform that mutates the message
      // cannot write back into the config and change what the next tick starts
      // from.
      this.fire(() => this.interpolateDeep(cloneMessage(this.config.message)));
    }, this.intervalMs);
    this.info("Enabled repeat.");
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.repeat);
    this.info("Disabled repeat.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:repeat",
  description: "Starts a message on a fixed interval.",
  options: {
    interval: {
      type: "any",
      description:
        'How long to wait between messages, as a number of milliseconds or a string with a unit such as "5m".',
      required: true,
      unit: "ms",
    },
    message: {
      type: "any",
      description:
        "The message each tick starts. Every string inside it is interpolated.",
      interpolated: true,
    },
  },
};
