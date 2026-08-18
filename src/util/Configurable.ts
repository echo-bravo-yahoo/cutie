import { globals } from "../index.js";
import { applySchemaDefaults, getRegisteredSchema } from "./schema.js";
import { isStep, Kind } from "./type-helpers.js";

export interface Config {
  disabled?: boolean;
}

// The schema is the declared source of defaults. A config with no `type`, or
// whose module has not been imported yet, is returned untouched.
function withSchemaDefaults(config: Config): Config {
  const type = (config as { type?: unknown }).type;
  if (typeof type !== "string") return config;

  const schema = getRegisteredSchema(type);
  if (schema === undefined) return config;

  return applySchemaDefaults(config, schema);
}

export interface LogLineOptions {
  topic: string;
  traceId?: string;
}

export class Configurable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (msg: string, opts: LogLineOptions, obj?: Record<string, any>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: (msg: string, opts: LogLineOptions, obj?: Record<string, any>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (msg: string, opts: LogLineOptions, obj?: Record<string, any>) => void;
  logPrefix: string;
  config: Config;
  enabled: boolean;
  name: string;
  // "unknown" until a subclass parses a `kind:subKind` type string.
  kind: Kind | "unknown" = "unknown";

  constructor(config: Config, name: string) {
    this.debug = (msg, opts, obj) => {
      globals.logger.emit(
        Configurable.formatLogLine(msg, opts),
        "debug",
        opts.topic,
        obj,
        opts.traceId,
      );
    };

    this.info = (msg, opts, obj) => {
      globals.logger.emit(
        Configurable.formatLogLine(msg, opts),
        "info",
        opts.topic,
        obj,
        opts.traceId,
      );
    };

    this.error = (msg, opts, obj) => {
      globals.logger.emit(
        Configurable.formatLogLine(msg, opts),
        "error",
        opts.topic,
        obj,
        opts.traceId,
      );
    };

    // subclasses that log under a topic override this
    this.logPrefix = "";
    this.config = withSchemaDefaults(config);
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
      kind: parts[0] as Kind,
      subKind: parts[1],
    };
  }

  static formatLogLine(message: string, context: LogLineOptions) {
    return `${context.topic ? `[${context.topic}] ` : ""}${message}${context.traceId ? ` (${context.traceId})` : ""}`;
  }
}
