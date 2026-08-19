import { globals } from "./globals.js";
import { applySchemaDefaults, getRegisteredSchema } from "./schema.js";
import { Kind } from "./type-helpers.js";

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
  // Defaults to the instance's own logPrefix, which is what every line in the
  // tree wants; pass one only to log somewhere else deliberately.
  topic?: string;
  traceId?: string;
}

type LogLine = (
  msg: string,
  opts?: LogLineOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj?: Record<string, any>,
) => void;

// Task is the only direct subclass: a task is named by its key in the `tasks:`
// record, while everything else a config declares carries a `type` and so is a
// Module.
export class Configurable {
  debug: LogLine;
  info: LogLine;
  warn: LogLine;
  error: LogLine;
  logPrefix: string;
  config: Config;
  enabled: boolean;
  name: string;
  // "unknown" until a subclass parses a `kind:subKind` type string.
  kind: Kind | "unknown" = "unknown";

  constructor(config: Config, name: string) {
    const at =
      (verbosity: "debug" | "info" | "warn" | "error"): LogLine =>
      (msg, opts = {}, obj) => {
        // Read here rather than closed over: logPrefix is assigned after this
        // constructor returns, by whichever subclass owns the topic.
        const topic = opts.topic ?? this.logPrefix;

        globals.logger.emit(
          Configurable.formatLogLine(msg, { ...opts, topic }),
          verbosity,
          topic,
          obj,
          opts.traceId,
        );
      };

    this.debug = at("debug");
    this.info = at("info");
    this.warn = at("warn");
    this.error = at("error");

    // subclasses that log under a topic override this
    this.logPrefix = "";
    this.config = withSchemaDefaults(config);
    this.name = name;
    this.enabled = false;
  }

  async register() {}

  shouldEnable(): boolean {
    return !this.config.disabled;
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
