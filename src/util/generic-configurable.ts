import { globals } from "../index.js";
import { isStep, isTask } from "./type-helpers.js";
import get from "lodash/get.js";

export interface Config {
  disabled?: boolean;
}

export interface PrefixInfo {
  type?: string;
  traceId?: string;
}

export class Configurable {
  debug: (obj: string | Record<string, any>, msg?: string) => void;
  info: (obj: string | Record<string, any>, msg?: string) => void;
  error: (obj: string | Record<string, any>, msg?: string) => void;
  logPrefix: string;
  config: Config;
  enabled: boolean;
  name: string;

  constructor(config: Config, name: string) {
    this.debug = (obj, msg) => {
      globals.logger.debug(...Configurable.buildLoggerArgs(obj, msg));
    };

    this.info = (obj, msg) => {
      globals.logger.info(...Configurable.buildLoggerArgs(obj, msg));
    };

    this.error = (obj, error) => {
      globals.logger.error(...Configurable.buildLoggerArgs(obj, error));
    };

    // TO-DO: fix
    this.logPrefix = "";
    this.config = config;
    this.name = name;
  }

  async register() {
    const hasDisabledParent =
      (this as unknown as any).task &&
      (this as unknown as any).task.config.disabled;
    if (!this.config.disabled && !hasDisabledParent) await this.enable();
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

  // always includes the context of task, module/config, and globals
  interpolateConfigString(
    template: string,
    additionalContext?: Record<string, any>
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

  static prefix(message: string, prefixInfo: PrefixInfo) {
    return `${prefixInfo.type ? `[${prefixInfo.type}] ` : ""}${message}${prefixInfo.traceId ? ` (${prefixInfo.traceId})` : ""}`;
  }

  static buildLoggerArgs(
    obj: string | Record<string, any>,
    msgOrError?: string
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
