import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { cloneMessage } from "../util/Step.js";
import { parseDuration } from "../util/duration.js";
import { newTraceId } from "../util/trace.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface OnceConfig extends TriggerConfig {
  delay?: number | string;
  message?: Message;
}

export default class Once extends Trigger {
  declare config: OnceConfig;
  delayMs = 0;

  constructor(config: OnceConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    this.delayMs = parseDuration(this.config.delay, "delay");
  }

  delayedStartMessage() {
    setTimeout(() => {
      const traceId = newTraceId();
      const message =
        this.delayMs > 0
          ? `Running step once after a delay of ${this.delayMs} ms.`
          : "Running step once, immediately.";
      this.info(message, { traceId });
      this.fire(
        () => this.interpolateDeep(cloneMessage(this.config.message)),
        traceId,
      );
    }, this.delayMs);
  }

  async enable() {
    this.delayedStartMessage();
    this.enabled = true;
  }

  async disable() {
    this.info("Skipping running step once.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:once",
  description: "Starts a single message when the node starts.",
  options: {
    delay: {
      type: "any",
      description:
        'How long to wait before starting the message, as a number of milliseconds or a string with a unit such as "2s".',
      default: 0,
      unit: "ms",
    },
    message: {
      type: "any",
      description:
        "The message to start. Every string inside it is interpolated.",
      interpolated: true,
    },
  },
};
