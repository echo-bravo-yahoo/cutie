import Input, { InputConfig } from "../util/generic-input.js";
import Task from "../util/generic-task.js";

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
    this.enable();
  }

  async enable() {
    this.task.postRegister = this.handleMessage.bind(this, this.config.message);
    this.info("Running immediate task.");
    this.enabled = true;
  }

  async handleMessage(message: any) {
    if (this.next) this.next.handleMessage(message);
  }

  async disable() {
    this.info("Skipping running immediate task.");
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
