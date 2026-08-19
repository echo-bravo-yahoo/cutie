import get from "lodash/get.js";

import Read, { ReadConfig } from "../util/Read.js";
import { currentMessageContext } from "../util/Step.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface StashConfig extends ReadConfig {
  key: Message;
}

export default class Stash extends Read {
  declare config: StashConfig;

  constructor(config: StashConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async read(message: Message, _traceId: string) {
    const key = this.interpolateConfigString(String(this.config.key), {
      message,
    });

    return get(currentMessageContext()?.stash, key);
  }

  async enable() {
    this.info("Enabled reading from stash.");
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled reading from stash.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:stash",
  description:
    "Replaces the message with a value the same message stashed earlier.",
  options: {
    key: {
      type: "string",
      description:
        "Which stashed value to read; a dotted key reads a nested path.",
      required: true,
      interpolated: true,
    },
  },
};
