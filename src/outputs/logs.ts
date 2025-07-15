import { globals } from "../index.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { SerializedLogLine } from "../util/LogHelper.js";

export interface LogsConfig extends OutputConfig {}

export default class Logs extends Output {
  declare config: LogsConfig;

  constructor(config: LogsConfig, task: Task) {
    super(config, task);
  }

  async send(message: any) {
    const typedMessage = message as unknown as SerializedLogLine;
    globals.logger[typedMessage.verbosity](
      typedMessage.log,
      typedMessage.object,
    );

    return message;
  }
}

/*
{
  "type": "output:console",
  "disabled": false,
}
*/
