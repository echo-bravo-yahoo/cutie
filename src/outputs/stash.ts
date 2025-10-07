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
      `Emitting event with key "${this.config.key}".`,
      {
        topic: this.logPrefix,
      },
      {
        event: message,
      },
    );
    this.ensureStash();
    // @ts-expect-error ensureStash() makes sure this defined
    this.task.stash[
      this.interpolateConfigString(this.config.key, { message })
    ] = this.interpolateConfigString(this.config.value, { message });

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
