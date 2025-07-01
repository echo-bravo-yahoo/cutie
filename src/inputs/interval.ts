import Input, { InputConfig } from "../util/generic-input.js";
import Task from "../util/generic-task.js";

export interface IntervalConfig extends InputConfig {
  interval: number;
  message: any;
}

export default class Interval extends Input {
  config: IntervalConfig;
  interval: NodeJS.Timeout;
  enabled: boolean;

  constructor(config: IntervalConfig, task: Task) {
    super(config, task);
  }

  register() {
    this.enable();
  }

  async enable() {
    this.interval = setInterval(
      this.handleMessage.bind(this, this.config.message),
      this.config.interval
    );
    this.info("Enabled interval.");
    this.enabled = true;
  }

  async handleMessage(message: any) {
    if (this.next) this.next.handleMessage(message);
  }

  async disable() {
    clearInterval(this.interval);
    this.info("Disabled interval.");
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
