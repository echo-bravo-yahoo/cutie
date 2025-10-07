import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface ConsoleConfig extends OutputConfig {}

export default class Console extends Output {
  declare config: ConsoleConfig;

  constructor(config: ConsoleConfig, task: Task) {
    super(config, task);
  }

  async send(message: Message) {
    if (typeof message !== "string") message = JSON.stringify(message);

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
