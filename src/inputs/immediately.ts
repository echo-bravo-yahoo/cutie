import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";

export interface ImmediatelyConfig extends InputConfig {
  delay?: number;
  message: any;
}

export default class Immediately extends Input {
  declare config: ImmediatelyConfig;
  declare task: any;
  enabled: boolean;

  constructor(config: ImmediatelyConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: ImmediatelyConfig): ImmediatelyConfig {
    return {
      delay: 0,
      ...config,
    };
  }

  delayedStartMessage() {
    setTimeout(() => {
      this.info(
        `Running one shot task after a delay of ${this.config.delay} ms.`,
        { topic: this.logPrefix },
      );
      this.startMessage(this.config.message);
    }, this.config.delay);
  }

  async enable() {
    this.delayedStartMessage();
    this.enabled = true;
  }

  async disable() {
    this.info("Skipping running immediate task.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "immediately",
  "disabled": false,
  "delay": 10000 // in ms
}
*/
