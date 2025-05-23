import { Module } from "../util/generic-module.js";
import { TimerBasedCronScheduler as scheduler } from "cron-schedule/schedulers/timer-based.js";
import { parseCronExpression } from "cron-schedule";

export default class Interval extends Module {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.config.enabled) {
      this.enable();
    }
  }

  errorHandler() {}

  async enable() {
    this.cronHandle = scheduler.setTimeout(
      parseCronExpression(this.config.expression),
      this.runAllTransformations.bind(this, this.config.message),
      { errorHandler: this.errorHandler }
    );
    this.info({}, `Enabled cron task.`);
    this.enabled = true;
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
  "enabled": true,
  "message": { ... },
  "expression": "* * * * *" // in cron format
}
*/
