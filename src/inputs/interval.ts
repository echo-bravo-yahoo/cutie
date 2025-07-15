import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";

export interface IntervalConfig extends InputConfig {
  interval: number;
  message: any;
}

export default class Interval extends Input {
  declare config: IntervalConfig;
  interval: NodeJS.Timeout;
  enabled: boolean;

  constructor(config: IntervalConfig, task: Task) {
    super(config, task);
  }

  register() {
    return this.enable();
  }

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
