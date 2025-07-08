import Input, { InputConfig } from "../util/Input.js";
import Task from "../util/Task.js";

export interface ImmediatelyConfig extends InputConfig {
  expression: string;
  message: any;
}

export default class Immediately extends Input {
  declare config: ImmediatelyConfig;
  declare task: any;
  enabled: boolean;

  constructor(config: ImmediatelyConfig, task: Task) {
    super(config, task);
  }

  register() {
    return this.enable();
  }

  async enable() {
    this.task.postRegister = this.handleMessage.bind(this, this.config.message);
    this.info("Running immediate task.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.info("Skipping running immediate task.", { topic: this.logPrefix });
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
