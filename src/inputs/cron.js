import { TimerBasedCronScheduler as scheduler } from "cron-schedule/schedulers/timer-based.js";
import { parseCronExpression } from "cron-schedule";

import Input from "../util/generic-input";

export default class Interval extends Input {
  constructor(config, task) {
    super(config, task);
  }

  errorHandler() {}

  async enable() {
    this.cronHandle = scheduler.setTimeout(
      parseCronExpression(this.config.expression),
      this.handleMessage.bind(this, this.config.message),
      { errorHandler: this.errorHandler }
    );
    this.info({}, `Enabled cron task.`);
    this.enabled = true;
  }

  async handleMessage(message) {
    if (this.next) this.next.handleMessage(message);
  }

  async disable() {
    scheduler.clearTimeoutOrInterval(this.cronHandle);
    this.info({}, `Disabled cron task.`);
    this.enabled = false;
  }
}

/*
{
  "type": "cron",
  "disabled": false,
  "message": { ... },
  "expression": "* * * * *" // in cron format
}
*/
