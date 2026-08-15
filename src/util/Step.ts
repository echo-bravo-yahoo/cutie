import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";

import get from "lodash/get.js";

import { globals, srcDir } from "../index.js";
import Task from "./Task.js";
import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";
import { Message } from "./type-helpers.js";

export interface StepConfig extends TypedConfig {}

// Returned by a step that swallows a message rather than passing it on, so the
// chain stops without leaving the caller's promise unsettled.
export const HALT = Symbol("halt");

export interface CodeConfig {
  codePath?: string;
  command?: string;
}

export default abstract class Step extends TypedConfigurable {
  declare config: StepConfig;
  task: Task;
  next?: Step;
  declare logPrefix: string;

  constructor(config: StepConfig, task: Task) {
    super(config);

    this.task = task;
    const index = task.config.steps.findIndex((step) => step === this.config);
    this.logPrefix = `${this.task.logPrefix}.steps.${index}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateContext(additionalContext: Record<string, any> = {}) {
    return {
      task: { ...this.task, stash: undefined },
      // we present stash like it's _not_ stored on the task
      stash: this.task.stash,
      module: this.config,
      env: process.env,
      globals: { ...globals, logger: undefined },
      ...additionalContext,
    };
  }

  // always includes the context of task, module/config, and globals
  interpolateConfigString(
    template: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additionalContext?: Record<string, any>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inject = (str: string, obj: Record<string, any>) =>
      str.replace(/\${(.*?)}/g, (_x, path) => get(obj, path));

    const result = inject(template, this.generateContext(additionalContext));

    return result;
  }

  // Interpolates every string reachable from a config-supplied value, not just
  // a top-level one, so a message can be an object with interpolated fields.
  interpolateDeep(
    value: Message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additionalContext?: Record<string, any>,
  ): Message {
    if (typeof value === "string")
      return this.interpolateConfigString(value, additionalContext);
    if (Array.isArray(value))
      return value.map((item) => this.interpolateDeep(item, additionalContext));
    if (value === null || typeof value !== "object") return value;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = this.interpolateDeep(nested, additionalContext);
    }

    return result;
  }

  // transform:shell and transform:javascript build their code identically:
  // read codePath when set, otherwise interpolate command. Either way the
  // message is stringified first unless it already is a string, because
  // interpolation splices values into a string.
  generateCode(config: CodeConfig, message: Message) {
    const context = {
      message: typeof message === "string" ? message : JSON.stringify(message),
    };

    if (config.codePath) {
      const codePath = normalize(join(srcDir, "..", config.codePath));
      const code = readFileSync(codePath, { encoding: "utf8" });
      return this.interpolateConfigString(code, context);
    } else if (config.command) {
      return this.interpolateConfigString(config.command, context);
    }

    throw new Error(
      `Configuration should either specify a codePath or a command.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interpolatePath(path: Message, additionalContext?: Record<string, any>) {
    if (typeof path !== "string" || !path.startsWith("$$")) return path;
    const result = get(
      this.generateContext(additionalContext),
      path.slice(2),
      undefined,
    );

    return result;
  }

  async endMessage(message: Message, traceId?: string) {
    return this.task.endMessage(message, traceId);
  }

  async handleMessage(message: Message, traceId?: string): Promise<Message> {
    const handled = await this.doHandleMessage(message, traceId);

    // transform:accumulate halts every message that does not complete a batch
    if (handled === HALT) return undefined;
    message = handled;

    if (this.next) {
      return this.next.handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  async doHandleMessage(
    message: Message,
    _traceId?: string,
  ): Promise<Message | typeof HALT> {
    return message;
  }
}
