import { TimerBasedCronScheduler as scheduler } from "cron-schedule/schedulers/timer-based.js";
import { parseCronExpression } from "cron-schedule";

import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface CronConfig extends TriggerConfig {
  expression: string;
  message: Message;
}

export default class Cron extends Trigger {
  declare config: CronConfig;
  // cron-schedule's ITimerHandle is not importable -- its exports map only
  // exposes "." and the two scheduler entry points -- so derive it here.
  // @ts-expect-error cronHandle is instantiated by enable()
  cronHandle: ReturnType<typeof scheduler.setInterval>;

  constructor(config: CronConfig, task: Task) {
    super(config, task);
  }

  errorHandler(error: unknown) {
    this.error(`Cron task failed: ${error}`, { topic: this.logPrefix });
  }

  async enable() {
    this.cronHandle = scheduler.setInterval(
      parseCronExpression(this.config.expression),
      this.startMessage.bind(this, this.config.message),
      { errorHandler: this.errorHandler.bind(this) },
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
  "type": "trigger:cron",
  "disabled": false,
  "message": { ... },
  "expression": "* * * * *" // in cron format
}
*/
