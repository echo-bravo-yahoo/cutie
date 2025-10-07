import Trigger from "../util/Trigger.js";
import Task from "../util/Task.js";
import { StepConfig } from "../util/Step.js";
import { globals } from "../index.js";

export interface LogsConfig extends StepConfig {
  filters: Array<string>;
}

export type Verbosity = "fatal" | "error" | "info" | "debug" | "warn" | "trace";

export default class Logs extends Trigger {
  declare config: LogsConfig;

  constructor(config: LogsConfig, task: Task) {
    super(config, task);
  }

  async register() {
    globals.logger.logListeners.push(this);
    return super.register();
  }

  static matches(topic: string, _verbosity: string, filter: string): boolean {
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
    return Logs.shouldEmit(topic, verbosity, this.config.filters);
  }

  static shouldEmit(
    topic: string,
    verbosity: Verbosity,
    filters: Array<string>,
  ): boolean {
    const lastMatch = [...filters]
      .reverse()
      .find((filter) => this.matches(topic, verbosity, filter));
    if (lastMatch !== undefined) return this.filterToBoolean(lastMatch);
    return false;
  }
}
