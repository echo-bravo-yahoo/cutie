import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface ConsoleConfig extends OutputConfig {}

export default class Console extends Output {
  declare config: ConsoleConfig;

  constructor(config: ConsoleConfig, task: Task) {
    super(config, task);
  }

  async send(message: Message, _traceId: string) {
    // Serialise for printing only. Returning the serialised form would hand
    // every later step a JSON string instead of the object, so any step keyed
    // on a path would read undefined - and an output:mqtt further down would
    // publish a double-encoded string rather than the reading.
    console.log(
      typeof message === "string" ? message : JSON.stringify(message),
    );
    return message;
  }
}

/*
{
  "type": "output:console",
  "disabled": false
}
*/
