import { TimerBasedCronScheduler as scheduler } from "cron-schedule/schedulers/timer-based.js";
import { parseCronExpression } from "cron-schedule";

import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";

export interface CronConfig extends InputConfig {
  expression: string;
  message: any;
}

export default class Cron extends Input {
  declare config: CronConfig;
  cronHandle: any;
  enabled: boolean;

  constructor(config: CronConfig, task: Task) {
    super(config, task);
  }

  errorHandler() {}

  async enable() {
    this.cronHandle = scheduler.setTimeout(
      parseCronExpression(this.config.expression),
      this.startMessage.bind(this, this.config.message),
      { errorHandler: this.errorHandler },
    );
    this.info("Enabled cron task.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    scheduler.clearTimeoutOrInterval(this.cronHandle);
    this.info("Disabled cron task.", { topic: this.logPrefix });
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
