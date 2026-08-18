import { TimerBasedCronScheduler as scheduler } from "cron-schedule/schedulers/timer-based.js";
import { parseCronExpression } from "cron-schedule";

import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { cloneMessage } from "../util/Step.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

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

  constructor(config: CronConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  errorHandler(error: unknown) {
    this.error(`Cron task failed: ${error}`, { topic: this.logPrefix });
  }

  async enable() {
    this.cronHandle = scheduler.setInterval(
      parseCronExpression(this.config.expression),
      () =>
        // Cloned before interpolation so a transform that mutates the message
        // cannot write back into the config and change what the next firing
        // starts from.
        this.startMessage(
          this.interpolateDeep(cloneMessage(this.config.message)),
        ),
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

export const schema: ModuleSchema = {
  type: "trigger:cron",
  description: "Starts a message on a cron schedule.",
  options: {
    expression: {
      type: "string",
      description:
        'A cron expression, such as "*/5 * * * *" for every five minutes.',
      required: true,
    },
    message: {
      type: "any",
      description:
        "The message each firing starts. Every string inside it is interpolated.",
      interpolated: true,
    },
  },
};
