import { globals } from "../index.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { SerializedLogLine } from "../util/LogHelper.js";
import { Message } from "../util/type-helpers.js";

export interface LogsConfig extends OutputConfig {}

export default class Logs extends Output {
  declare config: LogsConfig;

  constructor(config: LogsConfig, task: Task) {
    super(config, task);
  }

  async send(message: Message) {
    const typedMessage = message as unknown as SerializedLogLine;
    globals.logger[typedMessage.verbosity](
      typedMessage.log,
      typedMessage.object,
    );

    return typeof message !== "string" ? JSON.stringify(message) : message;
  }
}

/*
{
  "type": "output:console",
  "disabled": false,
}
*/
