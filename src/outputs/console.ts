import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";

export interface ConsoleConfig extends OutputConfig {
  spaces?: number;
}

export default class Console extends Output {
  declare config: ConsoleConfig;

  constructor(config: ConsoleConfig, task: Task) {
    super(config, task);
  }

  async send(message: any) {
    console.log(`${JSON.stringify(message, null, this.config.spaces || 0)}`);
    return message;
  }
}

/*
{
  "type": "output:console",
  "disabled": false,
  "spaces": number
}
*/
