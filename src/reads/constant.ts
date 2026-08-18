import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface ConstantConfig extends ReadConfig {
  value: Message;
}

export default class Constant extends Read {
  declare config: ConstantConfig;

  constructor(config: ConstantConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async read(message: Message, _traceId: string) {
    return this.interpolateDeep(this.config.value, { message });
  }

  async enable() {
    this.info("Enabled constant read.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled constant read.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:constant",
  description: "Replaces the message with a value from the config.",
  options: {
    value: {
      type: "any",
      description:
        "What the message becomes. Every string inside it is interpolated.",
      required: true,
      interpolated: true,
    },
  },
};
