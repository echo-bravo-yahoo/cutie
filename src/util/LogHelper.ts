import { AsyncLocalStorage } from "node:async_hooks";

import loggerFactory, { Logger, LoggerOptions } from "pino";

import Logs, { Verbosity } from "../triggers/logs.js";
import { LOG_LEVELS } from "./cli.js";
import { Configurable } from "./Configurable.js";
import { globals } from "./globals.js";

// Where the runtime's own lines land. Code that is not a Configurable has no
// logPrefix to log under, but its lines still belong on the bus: a node whose
// whole job is republishing its own logs must not lose the one about the
// uncaught exception that killed it.
export const CORE_TOPIC = "core.runtime";

// The ergonomic wrapper a Configurable gets from `this.info`, for the code that
// is not one.
export function logAt(
  topic: string,
  verbosity: Verbosity,
  message: string,
  object?: object,
) {
  globals.logger.emit(
    Configurable.formatLogLine(message, { topic }),
    verbosity,
    topic,
    object,
  );
}

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

// A logs task's own topic is the bare prefix, and its steps' topics extend it.
// Checked both when a line is emitted and when a held one is replayed, so a
// task cannot observe itself either way.
function ownSubtree(listener: Logs, topic: string): boolean {
  return (
    topic === listener.task.logPrefix ||
    topic.startsWith(`${listener.task.logPrefix}.`)
  );
}

export default class LogHelper {
  declare logListeners: Array<Logs>;
  declare logger: Logger;
  level: Verbosity;
  // Lines emitted before any listener existed. Connections register before
  // tasks, so the likeliest first failure on a fresh node -- an unreachable
  // broker -- happens when there is nowhere yet to route it, and without this
  // it could never reach a trigger:logs task at all.
  //
  // At every level and with no size cap, because a line dropped for arriving
  // early, or for being `debug`, is exactly the line an operator is missing.
  // What makes that safe is that the window closes: stopBuffering() ends it
  // when registration does, whether or not a listener ever appeared.
  private held?: Array<SerializedLogLine> = [];

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

  // Through emit rather than straight to pino, so that a line from the runtime
  // itself reaches a trigger:logs task the same way a module's line does. emit
  // writes to pino first, so the console sees exactly what it saw before.
  info(message: string, object?: object) {
    return this.emit(message, "info", CORE_TOPIC, object);
  }

  error(message: string, object?: object) {
    return this.emit(message, "error", CORE_TOPIC, object);
  }

  debug(message: string, object?: object) {
    return this.emit(message, "debug", CORE_TOPIC, object);
  }

  warn(message: string, object?: object) {
    return this.emit(message, "warn", CORE_TOPIC, object);
  }

  trace(message: string, object?: object) {
    return this.emit(message, "trace", CORE_TOPIC, object);
  }

  fatal(message: string, object?: object) {
    return this.emit(message, "fatal", CORE_TOPIC, object);
  }

  meetsLevel(verbosity: Verbosity) {
    return LOG_LEVELS.indexOf(verbosity) >= LOG_LEVELS.indexOf(this.level);
  }

  // Registering a listener replays the window to it, in emission order and
  // through the same guards a live line passes: a listener filters the held
  // lines itself rather than being handed lines it did not ask for.
  addListener(listener: Logs) {
    this.logListeners.push(listener);

    const held = this.held;
    if (!held) return;

    // Inside one dispatch, as the live fan-out is, so a replayed line starts
    // no dispatch of its own however many awaits later it finishes.
    dispatching.run(true, () => {
      for (const line of held)
        if (
          !ownSubtree(listener, line.topic) &&
          listener.shouldEmit(line.topic, line.verbosity)
        )
          listener.startMessage(line, line.traceId);
    });
  }

  removeListener(listener: Logs) {
    const index = this.logListeners.indexOf(listener);
    if (index !== -1) this.logListeners.splice(index, 1);
  }

  // Ends the window. Called when registration ends, whether or not a
  // trigger:logs task turned up: a config that declares none would otherwise
  // leave the node holding every line it ever writes.
  stopBuffering() {
    this.held = undefined;
  }

  // Returns once every listener this line reached has finished with it.
  // Nothing in the ordinary path awaits that -- a log line must not slow the
  // code that wrote it -- but a shutdown does, so the line about why the node
  // is stopping is not cut off by the shutdown it describes.
  emit(
    message: string,
    verbosity: Verbosity,
    topic: string,
    object?: object,
    traceId?: string,
  ): Promise<void> {
    // Module-level logging reaches the console through here. Without this a
    // node prints whatever output:console writes and nothing else. It happens
    // before either guard below, so a line that starts no dispatch is still
    // printed.
    if (this.meetsLevel(verbosity))
      this.logger[verbosity](object || {}, message);

    // Two guards, against two different loops. This one stops a log-driven
    // task from observing itself.
    if (this.logListeners.some((listener) => ownSubtree(listener, topic)))
      return Promise.resolve();

    // And this one stops a loop that leaves the task's own topics and comes
    // back -- through output:event into another task, say. Anything logged
    // while a line is being dispatched inherits the context, however many
    // awaits later, and starts no dispatch of its own.
    if (dispatching.getStore()) return Promise.resolve();

    // Held rather than dropped while there is nobody to route it to; replayed
    // by addListener to whichever listener turns up first.
    if (this.held && this.logListeners.length === 0)
      this.held.push({
        object: object as object,
        log: message,
        verbosity,
        topic,
        traceId,
      });

    const dispatched: Array<unknown> = [];

    dispatching.run(true, () => {
      for (const listener of this.logListeners)
        if (listener.shouldEmit(topic, verbosity))
          dispatched.push(
            listener.startMessage(
              { object, log: message, verbosity, topic, traceId },
              traceId,
            ),
          );
    });

    return Promise.allSettled(dispatched).then(() => {});
  }
}
