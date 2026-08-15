import Trigger from "../util/Trigger.js";
import Task from "../util/Task.js";
import { StepConfig } from "../util/Step.js";
import { globals } from "../index.js";

export interface LogsConfig extends StepConfig {
  filters: Array<string>;
  minVerbosity?: Verbosity;
}

export type Verbosity = "fatal" | "error" | "info" | "debug" | "warn" | "trace";

const VERBOSITY_RANK: Record<Verbosity, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export default class Logs extends Trigger {
  declare config: LogsConfig;

  constructor(config: LogsConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: LogsConfig): LogsConfig {
    return {
      // emit every level unless the config narrows it
      minVerbosity: "trace",
      ...config,
    };
  }

  // Listening starts at enable rather than register, so a logs trigger in a
  // disabled task receives nothing.
  async enable() {
    globals.logger.logListeners.push(this);
    this.enabled = true;
  }

  async disable() {
    const index = globals.logger.logListeners.indexOf(this);
    if (index !== -1) globals.logger.logListeners.splice(index, 1);
    this.enabled = false;
  }

  static matches(topic: string, filter: string): boolean {
    if (filter === "") return false;
    if (filter[0] === "!") filter = filter.slice(1);

    // TODO: improve the regex so the filter step isn't necessary
    const filterTokens = filter
      .split(/([.*])/)
      .filter((token) => token !== "." && token !== "")
      .reverse();
    const topicTokens = topic.split(/[.]/).reverse();

    let currentTopicToken = topicTokens.shift();
    let currentFilterToken = filterTokens.shift();
    let nextFilterToken = filterTokens[0];

    while (currentTopicToken !== undefined) {
      if (currentFilterToken === "*") {
        // when we're done with a wildcard
        if (currentTopicToken === nextFilterToken) {
          filterTokens.shift();
          currentFilterToken = filterTokens.shift();
          nextFilterToken = filterTokens[0];
        }
      } else {
        if (currentTopicToken === currentFilterToken)
          currentFilterToken = filterTokens.shift();
      }
      currentTopicToken = topicTokens.shift();
    }

    if (filterTokens.length === 0) {
      return currentFilterToken === "*"
        ? true
        : currentTopicToken === currentFilterToken;
    } else {
      return false;
    }
  }

  static filterToBoolean(filter: string): boolean {
    return filter[0] !== "!";
  }

  shouldEmit(topic: string, verbosity: Verbosity): boolean {
    return Logs.shouldEmit(
      topic,
      verbosity,
      this.config.filters,
      this.config.minVerbosity,
    );
  }

  static shouldEmit(
    topic: string,
    verbosity: Verbosity,
    filters: Array<string>,
    minVerbosity: Verbosity = "trace",
  ): boolean {
    if (VERBOSITY_RANK[verbosity] < VERBOSITY_RANK[minVerbosity]) return false;

    const lastMatch = [...filters]
      .reverse()
      .find((filter) => this.matches(topic, filter));
    if (lastMatch !== undefined) return this.filterToBoolean(lastMatch);
    return false;
  }
}
