import Output, { OutputConfig } from "../util/generic-output.js";
import Task from "../util/generic-task.js";

export interface ConsoleConfig extends OutputConfig {
  spaces?: number;
}

export default class Console extends Output {
  config: ConsoleConfig;

  constructor(config: ConsoleConfig, task: Task) {
    super(config, task);
  }

  async register() {}

  async enable() {}

  async disable() {}

  async send(message: any) {
    console.log(
      `CONSOLE OUTPUT: ${JSON.stringify(message, null, this.config.spaces || 0)}`
    );
  }
}

/*
{
  "type": "output:console",
  "disabled": false,
  "spaces": number
}
*/
