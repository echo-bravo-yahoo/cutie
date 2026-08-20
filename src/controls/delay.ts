import Control, { ControlConfig } from "../util/Control.js";
import Task from "../util/Task.js";
import { parseDuration } from "../util/duration.js";
import { ModuleSchema } from "../util/schema.js";
import { Message } from "../util/type-helpers.js";

export interface DelayConfig extends ControlConfig {
  duration: number | string;
}

// Holds the message here for a fixed duration before the rest of the chain
// runs. A plain setTimeout-backed await, so it costs this message's own
// progress and nothing else this process is doing.
export default class Delay extends Control {
  declare config: DelayConfig;
  delayMs = 0;

  constructor(config: DelayConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    await super.register();
    this.delayMs = parseDuration(this.config.duration, "duration");
  }

  async doHandleMessage(message: Message, _traceId: string) {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return message;
  }
}

export const schema: ModuleSchema = {
  type: "control:delay",
  description:
    "Holds the message here for a fixed duration before the rest of the chain runs.",
  options: {
    duration: {
      type: "any",
      description:
        'How long to wait, as a number of milliseconds or a string with a unit such as "2s".',
      required: true,
      unit: "ms",
    },
  },
};
