import { AsyncLocalStorage } from "node:async_hooks";

import loggerFactory, { Logger, LoggerOptions } from "pino";

import Logs, { Verbosity } from "../triggers/logs.js";
import { LOG_LEVELS } from "./cli.js";

export interface SerializedLogLine {
  log: string;
  object: object;
  verbosity: Verbosity;
  topic: string;
  traceId?: string;
}

// A trigger:logs task's own steps log while they run, and those lines arrive
// asynchronously: the dispatch below is deliberately not awaited, so a plain
// boolean would be cleared long before they land. An async context is inherited
// by every line a dispatch causes, however many awaits later, which is exactly
// the set of lines that would otherwise recurse. The cost is that a timer
// started inside a dispatch also inherits it.
const dispatching = new AsyncLocalStorage<true>();

export default class LogHelper {
  declare logListeners: Array<Logs>;
  declare logger: Logger;
  level: Verbosity;

  constructor(level: Verbosity = "debug") {
    if (!LOG_LEVELS.includes(level))
      throw new Error(
        `Unknown log level "${level}"; expected one of: ${LOG_LEVELS.join(", ")}.`,
      );

    this.level = level;
    this.logger = // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (loggerFactory as unknown as (options?: LoggerOptions<any>) => Logger)({
        level,
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

  meetsLevel(verbosity: Verbosity) {
    return LOG_LEVELS.indexOf(verbosity) >= LOG_LEVELS.indexOf(this.level);
  }

  emit(
    message: string,
    verbosity: Verbosity,
    topic: string,
    object?: object,
    traceId?: string,
  ) {
    // Module-level logging reaches the console through here. Without this a
    // node prints whatever output:console writes and nothing else. It happens
    // before either guard below, so a line that starts no dispatch is still
    // printed.
    if (this.meetsLevel(verbosity))
      this.logger[verbosity](object || {}, message);

    // Two guards, against two different loops. This one stops a log-driven
    // task from observing itself: the task's own topic is the bare prefix, and
    // its steps' topics extend it.
    if (
      this.logListeners.some(
        (listener) =>
          topic === listener.task.logPrefix ||
          topic.startsWith(`${listener.task.logPrefix}.`),
      )
    )
      return;

    // And this one stops a loop that leaves the task's own topics and comes
    // back -- through output:event into another task, say. Anything logged
    // while a line is being dispatched inherits the context, however many
    // awaits later, and starts no dispatch of its own.
    if (dispatching.getStore()) return;

    dispatching.run(true, () => {
      for (const listener of this.logListeners)
        if (listener.shouldEmit(topic, verbosity))
          listener.startMessage(
            { object, log: message, verbosity, topic, traceId },
            traceId,
          );
    });
  }
}
