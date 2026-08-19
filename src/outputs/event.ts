import { globals } from "../index.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { EventEmitter } from "stream";
import { ModuleSchema } from "../util/schema.js";

export interface EventConfig extends OutputConfig {
  key: string;
}

export default class Event extends Output {
  declare config: EventConfig;
  declare bus: EventEmitter;

  constructor(config: EventConfig, task: Task, index?: number) {
    super(config, task, index);

    this.bus = globals.eventBus;
  }

  async send(message: Message, traceId: string) {
    this.info(
      `Emitting event with key "${this.config.key}".`,
      { traceId },
      {
        event: message,
      },
    );
    // The trace rides along as a second argument, so trigger:event continues
    // it rather than starting one of its own. An external listener taking one
    // argument is unaffected.
    //
    // The stash and the error do not cross, which nothing ever decided: see
    // .claude/docs/design-principles.md, "Message context across a hand-off".
    globals.eventBus.emit(this.config.key, message, traceId);
    return message;
  }
}

export const schema: ModuleSchema = {
  type: "output:event",
  description:
    "Emits the message on this node's internal event bus, where a trigger:event with the same key picks it up. A way to hand work from one task to another without a broker.",
  options: {
    key: {
      type: "string",
      description: "The event name to emit under.",
      required: true,
    },
  },
};
