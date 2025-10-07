import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface RepeatConfig extends TriggerConfig {
  interval: number;
  message: Message;
}

export default class Repeat extends Trigger {
  declare config: RepeatConfig;
  // @ts-expect-error repeat is instantiated by enable()
  repeat: NodeJS.Timeout;

  constructor(config: RepeatConfig, task: Task) {
    super(config, task);
  }

  async register() {}

  async enable() {
    this.repeat = setInterval(
      this.startMessage.bind(this, this.config.message),
      this.config.interval,
    );
    this.info("Enabled repeat.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.repeat);
    this.info("Disabled repeat.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "repeat",
  "disabled": false,
  "message": { ... },
  "interval": 10000 // in ms
}
*/
