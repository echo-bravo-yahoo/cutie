import loggerFactory, { Logger, LoggerOptions } from "pino";

import Logs, { Verbosity } from "../triggers/logs.js";

export interface SerializedLogLine {
  log: string;
  object: object;
  verbosity: Verbosity;
  topic: string;
  traceId?: string;
}

export default class LogHelper {
  declare logListeners: Array<Logs>;
  declare logger: Logger;

  constructor() {
    this.logger = // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (loggerFactory as unknown as (options?: LoggerOptions<any>) => Logger)({
        level: "debug",
        messageKey: "log",
        errorKey: "error",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      });

    this.logListeners = [];
  }

  info(message: string, object?: object) {
    this.logger.info(object || {}, message);
  }

  error(message: string, object?: object) {
    this.logger.error(object || {}, message);
  }

  debug(message: string, object?: object) {
    this.logger.debug(object || {}, message);
  }

  warn(message: string, object?: object) {
    this.logger.warn(object || {}, message);
  }

  trace(message: string, object?: object) {
    this.logger.trace(object || {}, message);
  }

  fatal(message: string, object?: object) {
    this.logger.fatal(object || {}, message);
  }

  emit(
    message: string,
    verbosity: Verbosity,
    topic: string,
    object?: object,
    traceId?: string,
  ) {
    // A line logged by a log-driven task would come straight back through this
    // bus and loop forever, so those tasks' lines are never dispatched. The
    // task's own topic is the bare prefix; its steps' topics extend it.
    if (
      this.logListeners.some(
        (listener) =>
          topic === listener.task.logPrefix ||
          topic.startsWith(`${listener.task.logPrefix}.`),
      )
    )
      return;

    for (const listener of this.logListeners) {
      if (listener.shouldEmit(topic, verbosity))
        listener.startMessage(
          { object, log: message, verbosity, topic, traceId },
          traceId,
        );
    }
  }
}
