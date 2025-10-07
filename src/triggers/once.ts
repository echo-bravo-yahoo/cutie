import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";

export interface OnceConfig extends TriggerConfig {
  delay?: number;
  message?: string;
}

export default class Once extends Trigger {
  declare config: OnceConfig;

  constructor(config: OnceConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: OnceConfig): OnceConfig {
    return {
      delay: 0,
      ...config,
    };
  }

  delayedStartMessage() {
    setTimeout(() => {
      const message =
        this.config.delay !== undefined
          ? `Running step once after a delay of ${this.config.delay} ms.`
          : "Running step once, immediately.";
      this.info(message, {
        topic: this.logPrefix,
      });
      // TODO: also interpolate strings on objects
      if (typeof this.config.message === "string") {
        this.startMessage(
          this.interpolateConfigString(this.config.message || ""),
        );
      } else {
        this.startMessage(this.config.message);
      }
    }, this.config.delay);
  }

  async enable() {
    this.delayedStartMessage();
    this.enabled = true;
  }

  async disable() {
    this.info("Skipping running step once.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:once",
  "name": "setupStuff",
  "disabled": false,
  "delay": 10000 // in ms
  "message": string,
}
*/
