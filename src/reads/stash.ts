import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface StashConfig extends ReadConfig {
  key: Message;
}

export default class Stash extends Read {
  declare config: StashConfig;

  constructor(config: StashConfig, task: Task) {
    super(config, task, {});
  }

  async read(message: Message, _traceId: string) {
    if (typeof this.config.key === "string")
      return this.interpolateConfigString(this.config.key, { message });

    return message;
  }

  async enable() {
    this.info("Enabled reading from stash.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled reading from stash.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "read:stash",
  "key": "string"
}
*/
