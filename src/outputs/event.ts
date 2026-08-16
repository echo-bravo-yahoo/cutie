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

  async send(message: Message, traceId: string) {
    this.info(
      `Emitting event with key "${this.config.key}".`,
      {
        topic: this.logPrefix,
        traceId,
      },
      {
        event: message,
      },
    );
    // The trace rides along as a second argument, so trigger:event continues
    // it rather than starting one of its own. An external listener taking one
    // argument is unaffected.
    globals.eventBus.emit(this.config.key, message, traceId);
    return message;
  }
}

/*
{
  "type": "output:event",
  "key": "a-happening",
}
*/
