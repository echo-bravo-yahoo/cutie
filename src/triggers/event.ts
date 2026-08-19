import { EventEmitter } from "stream";
import { globals } from "../index.js";
import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { newTraceId } from "../util/trace.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface EventConfig extends TriggerConfig {
  key: string;
}

export default class Event extends Trigger {
  declare config: EventConfig;
  declare bus: EventEmitter;
  // removeListener matches by reference, so enable() and disable() have to
  // hand the bus the same bound function.
  boundHandleEvent: (message: Message, traceId?: string) => void;

  constructor(config: EventConfig, task: Task, index?: number) {
    super(config, task, index);

    this.bus = globals.eventBus;
    this.boundHandleEvent = this.handleEvent.bind(this);
  }

  // output:event supplies the trace it was handling; anything else emitting on
  // the bus passes one argument, so the message starts a trace of its own.
  handleEvent(message: Message, upstreamTraceId?: string) {
    const traceId = upstreamTraceId ?? newTraceId();

    this.info(
      `Received event with key "${this.config.key}".`,
      { traceId },
      {
        event: message,
      },
    );
    this.fire(() => message, traceId);
  }

  async enable() {
    this.bus.on(this.config.key, this.boundHandleEvent);
    this.info(`Listening for events with key "${this.config.key}".`);
    this.enabled = true;
  }

  async disable() {
    this.bus.removeListener(this.config.key, this.boundHandleEvent);
    this.info(`No longer listening for events with key "${this.config.key}".`);
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:event",
  description:
    "Starts a message whenever an output:event on this node emits the matching key.",
  options: {
    key: {
      type: "string",
      description: "The event name to listen for.",
      required: true,
    },
  },
};
