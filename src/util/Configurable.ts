import { globals } from "../index.js";
import { isStep, isTask } from "./type-helpers.js";
import get from "lodash/get.js";

export interface Config {
  disabled?: boolean;
}

export interface LogLineOptions {
  topic: string;
  traceId?: string;
}

export class Configurable {
  debug: (msg: string, opts: LogLineOptions, obj?: Record<string, any>) => void;
  info: (msg: string, opts: LogLineOptions, obj?: Record<string, any>) => void;
  error: (msg: string, opts: LogLineOptions, obj?: Record<string, any>) => void;
  logPrefix: string;
  config: Config;
  enabled: boolean;
  name: string;
  addDefaultsToConfig?(config: Config): Config;

  constructor(config: Config, name: string) {
    this.debug = (msg, opts, obj) => {
      globals.logger.emit(
        Configurable.formatLogLine(msg, opts),
        "debug",
        opts.topic,
        obj,
      );
    };

    this.info = (msg, opts, obj) => {
      globals.logger.emit(
        Configurable.formatLogLine(msg, opts),
        "info",
        opts.topic,
        obj,
      );
    };

    this.error = (msg, opts, obj) => {
      globals.logger.emit(
        Configurable.formatLogLine(msg, opts),
        "error",
        opts.topic,
        obj,
      );
    };

    // TO-DO: fix
    this.logPrefix = "";
    if (this.addDefaultsToConfig) config = this.addDefaultsToConfig(config);
    this.config = config;
    this.name = name;
    this.enabled = false;
  }

  async register() {}

  shouldEnable(): boolean {
    let hasDisabledParent = false;
    if (isStep(this) && typeof this.task.config.disabled === "boolean") {
      hasDisabledParent = this.task.config.disabled;
    }

    return !this.config.disabled && !hasDisabledParent;
  }
  async enable() {
    this.enabled = true;
  }

  async disable() {
    this.enabled = false;
  }

  static parseType(type: string) {
    const parts = type.split(":");
    return {
      type: parts[0],
      subType: parts[1],
    };
  }

  static formatLogLine(message: string, context: LogLineOptions) {
    return `${context.topic ? `[${context.topic}] ` : ""}${message}${context.traceId ? ` (${context.traceId})` : ""}`;
  }

  // always includes the context of task, module/config, and globals
  interpolateConfigString(
    template: string,
    additionalContext?: Record<string, any>,
  ) {
    const inject = (str: string, obj: Record<string, any>) =>
      str.replace(/\${(.*?)}/g, (_x, path) => get(obj, path));

    const context: any = {
      module: this.config,
      globals: { ...globals, logger: undefined },
      ...additionalContext,
    };

    if (isStep(this)) {
      context.task = this.task;
    } else if (isTask(this)) {
      context.task = this;
    }

    const result = inject(template, context);

    return result;
  }

  static buildLoggerArgs(
    obj: string | Record<string, any>,
    msgOrError?: string,
  ): [Record<string, any>, message: string | undefined] {
    if (typeof obj === "string") {
      msgOrError = obj;
      obj = {};
    }

    return [
      {
        ...obj,
        tags: [...(obj.tags || [])],
      },
      msgOrError,
    ];
  }
}
