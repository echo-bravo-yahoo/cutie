import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";

export interface ConsoleConfig extends OutputConfig {}

export default class Console extends Output {
  declare config: ConsoleConfig;

  constructor(config: ConsoleConfig, task: Task) {
    super(config, task);
  }

  async send(message: any) {
    if (typeof message === "object") message = JSON.stringify(message);

    console.log(message);
    return message;
  }
}

/*
{
  "type": "output:console",
  "disabled": false
}
*/
