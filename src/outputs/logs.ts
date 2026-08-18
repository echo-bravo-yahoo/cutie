import { globals } from "../index.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { SerializedLogLine } from "../util/LogHelper.js";
import { Verbosity } from "../triggers/logs.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface LogsConfig extends OutputConfig {}

const VERBOSITIES: Array<Verbosity> = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

const FALLBACK_VERBOSITY: Verbosity = "info";

export default class Logs extends Output {
  declare config: LogsConfig;
  warnedVerbosities: Set<string> = new Set();

  constructor(config: LogsConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // A message can reach this output from anywhere, so its verbosity may be
  // absent or misspelled; indexing the logger with it directly threw.
  resolveVerbosity(verbosity: unknown): Verbosity {
    if (VERBOSITIES.includes(verbosity as Verbosity))
      return verbosity as Verbosity;

    const key = String(verbosity);
    if (!this.warnedVerbosities.has(key)) {
      this.warnedVerbosities.add(key);
      globals.logger.warn(
        `Unrecognized log verbosity "${key}"; logging at "${FALLBACK_VERBOSITY}" instead.`,
      );
    }

    return FALLBACK_VERBOSITY;
  }

  async send(message: Message, _traceId: string) {
    const typedMessage = message as unknown as SerializedLogLine;
    const verbosity = this.resolveVerbosity(typedMessage?.verbosity);

    globals.logger[verbosity](typedMessage?.log, typedMessage?.object);

    return typeof message !== "string" ? JSON.stringify(message) : message;
  }
}

export const schema: ModuleSchema = {
  type: "output:logs",
  description:
    "Writes the message to the node's own log. The message is expected in the shape trigger:logs produces, {log, object, verbosity, topic}; an unrecognized verbosity is logged at info.",
  options: {},
};
