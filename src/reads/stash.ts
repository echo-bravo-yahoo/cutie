import get from "lodash/get.js";

import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface StashConfig extends ReadConfig {
  key: Message;
}

export default class Stash extends Read {
  declare config: StashConfig;

  constructor(config: StashConfig, task: Task) {
    super(config, task);
  }

  async read(message: Message, _traceId: string) {
    const key = this.interpolateConfigString(String(this.config.key), {
      message,
    });

    return get(this.task.stash, key);
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
