import { EventEmitter } from "stream";
import { globals } from "../index.js";
import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface EventConfig extends TriggerConfig {
  key: string;
}

export default class Event extends Trigger {
  declare config: EventConfig;
  declare bus: EventEmitter;
  // removeListener matches by reference, so enable() and disable() have to
  // hand the bus the same bound function.
  boundHandleEvent: (message: Message) => void;

  constructor(config: EventConfig, task: Task) {
    super(config, task);

    this.bus = globals.eventBus;
    this.boundHandleEvent = this.handleEvent.bind(this);
  }

  handleEvent(message: Message) {
    this.info(
      `Received event with key "${this.config.key}".`,
      {
        topic: this.logPrefix,
      },
      {
        event: message,
      },
    );
    this.startMessage(message);
  }

  async enable() {
    this.bus.on(this.config.key, this.boundHandleEvent);
    this.info(`Listening for events with key "${this.config.key}".`, {
      topic: this.logPrefix,
    });
    this.enabled = true;
  }

  async disable() {
    this.bus.removeListener(this.config.key, this.boundHandleEvent);
    this.info(`No longer listening for events with key "${this.config.key}".`, {
      topic: this.logPrefix,
    });
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:event",
  "key": "a-happening",
}
*/
