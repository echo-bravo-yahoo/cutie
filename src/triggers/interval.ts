import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface IntervalConfig extends TriggerConfig {
  interval: number;
  message: Message;
}

export default class Interval extends Trigger {
  declare config: IntervalConfig;
  // @ts-expect-error interval is instantiated by enable()
  interval: NodeJS.Timeout;

  constructor(config: IntervalConfig, task: Task) {
    super(config, task);
  }

  async register() {}

  async enable() {
    this.interval = setInterval(
      this.startMessage.bind(this, this.config.message),
      this.config.interval,
    );
    this.info("Enabled interval.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.interval);
    this.info("Disabled interval.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "interval",
  "disabled": false,
  "message": { ... },
  "interval": 10000 // in ms
}
*/
