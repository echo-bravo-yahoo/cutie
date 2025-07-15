import loggerFactory, { Logger, LoggerOptions } from "pino";

import Logs, { Verbosity } from "../inputs/logs.js";

export interface SerializedLogLine {
  log: string;
  object: Object;
  verbosity: Verbosity;
  topic: string;
}

export default class LogHelper {
  declare logListeners: Array<Logs>;
  declare logger: Logger;

  constructor() {
    this.logger = (
      loggerFactory as unknown as (options?: LoggerOptions<any>) => Logger
    )({
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

  info(message: string, object?: Object) {
    this.logger.info(object || {}, message);
  }

  error(message: string, object?: Object) {
    this.logger.error(object || {}, message);
  }

  debug(message: string, object?: Object) {
    this.logger.debug(object || {}, message);
  }

  warn(message: string, object?: Object) {
    this.logger.warn(object || {}, message);
  }

  trace(message: string, object?: Object) {
    this.logger.trace(object || {}, message);
  }

  fatal(message: string, object?: Object) {
    this.logger.fatal(object || {}, message);
  }

  emit(message: string, verbosity: Verbosity, topic: string, object?: Object) {
    for (const listener of this.logListeners) {
      if (listener.shouldEmit(topic, verbosity))
        listener.startMessage({
          object,
          log: message,
          verbosity,
          topic,
        });
    }
  }
}
