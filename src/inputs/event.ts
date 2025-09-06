import { EventEmitter } from "stream";
import { globals } from "../index.js";
import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface EventConfig extends InputConfig {
  key: string;
}

export default class Event extends Input {
  declare config: EventConfig;
  declare bus: EventEmitter;

  constructor(config: EventConfig, task: Task) {
    super(config, task);

    this.bus = globals.eventBus;
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
    this.startMessage(typeof message === "object" ? { ...message } : message);
    // this.startMessage(message);
  }

  async enable() {
    this.bus.on(this.config.key, this.handleEvent.bind(this));
    this.info(`Listening for events with key "${this.config.key}".`, {
      topic: this.logPrefix,
    });
    this.enabled = true;
  }

  async disable() {
    this.bus.removeListener(this.config.key, this.handleEvent);
    this.info(`No longer listening for events with key "${this.config.key}".`, {
      topic: this.logPrefix,
    });
    this.enabled = false;
  }
}

/*
{
  "type": "input:event",
  "key": "a-happening",
}
*/
