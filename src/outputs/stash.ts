import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface StashConfig extends OutputConfig {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export default class Stash extends Output {
  declare config: StashConfig;

  constructor(config: StashConfig, task: Task) {
    super(config, task);
    this.ensureStash();
  }

  ensureStash() {
    if (!this.task.stash) this.task.stash = {};
  }

  async send(message: Message) {
    this.info(
      `Stashing value under key "${this.config.key}".`,
      {
        topic: this.logPrefix,
      },
      {
        event: message,
      },
    );
    this.ensureStash();
    // Only strings are interpolated; anything else is stashed as-is.
    const value =
      typeof this.config.value === "string"
        ? this.interpolateConfigString(this.config.value, { message })
        : this.config.value;
    // @ts-expect-error ensureStash() makes sure this defined
    this.task.stash[
      this.interpolateConfigString(this.config.key, { message })
    ] = value;

    return message;
  }
}

/*
{
  "type": "output:stash",
  "key": "someKey",
  "value": any
}
*/
