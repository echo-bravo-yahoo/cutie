import { globals } from "../index.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { EventEmitter } from "stream";

export interface EventConfig extends OutputConfig {
  key: string;
}

export default class Event extends Output {
  declare config: EventConfig;
  declare bus: EventEmitter;

  constructor(config: EventConfig, task: Task) {
    super(config, task);

    this.bus = globals.eventBus;
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
    globals.eventBus.emit(this.config.key, message);
    return message;
  }
}

/*
{
  "type": "output:event",
  "key": "a-happening",
}
*/
