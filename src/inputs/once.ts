import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";

export interface OnceConfig extends InputConfig {
  delay?: number;
  message: any;
}

export default class Once extends Input {
  declare config: OnceConfig;
  declare task: any;

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
      this.info(`Running step once after a delay of ${this.config.delay} ms.`, {
        topic: this.logPrefix,
      });
      this.startMessage(this.config.message);
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
  "type": "input:once",
  "name": "setupStuff",
  "disabled": false,
  "delay": 10000 // in ms
}
*/
