import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface ConstantConfig extends ReadConfig {
  value: Message;
}

export default class Constant extends Read {
  declare config: ConstantConfig;

  constructor(config: ConstantConfig, task: Task) {
    super(config, task);
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

/*
{
  "type": "read:constant",
  "value": any,
}
*/
