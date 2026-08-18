import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import get from "lodash/get.js";

import { globals } from "../index.js";
import { redact } from "./redact.js";
import Task from "./Task.js";
import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";
import { Message } from "./type-helpers.js";

export interface StepConfig extends TypedConfig {}

// Returned by a step that swallows a message rather than passing it on, so the
// chain stops without leaving the caller's promise unsettled.
export const HALT = Symbol("halt");

// What `${message}` resolves to before any message exists, which is every
// interpolation a trigger performs. Without it the template would stringify
// undefined and splice the text "undefined" into a topic or a path.
export const NO_MESSAGE = "(no message)";

export interface CodeConfig {
  codePath?: string;
  command?: string;
}

// What a code transform may coerce its result to. "any" hands back whatever the
// code produced.
export const CODE_OUTPUT_TYPES = ["object", "string", "number", "any"];

// generateCode prefers codePath and ignores command when both are set, so
// naming both is a config that does not mean what it looks like.
export function requireOneCodeSource(config: CodeConfig, type: string) {
  const sources = [config.codePath, config.command].filter(
    (source) => source !== undefined,
  );

  if (sources.length === 0)
    throw new Error(`"${type}" needs either a "codePath" or a "command".`);

  if (sources.length > 1)
    throw new Error(`"${type}": "codePath" cannot be combined with "command".`);
}

export interface MessageContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stash: Record<string, any>;
  // The message as it stands at the current step, not as the trigger produced
  // it, so ${message} means the same thing everywhere.
  message: Message;
  traceId?: string;
}

// One store per message rather than a field on the step or the task: a step is
// shared by every message the task handles, so a field would be overwritten by
// the next message the moment a step awaits. AsyncLocalStorage follows the
// message through those awaits instead.
const messageContext = new AsyncLocalStorage<MessageContext>();

export function currentMessageContext(): MessageContext | undefined {
  return messageContext.getStore();
}

export function runWithMessageContext<T>(
  context: MessageContext,
  body: () => T,
): T {
  return messageContext.run(context, body);
}

// Every relative path a config supplies is relative to the config file, not to
// wherever the process happened to be started. read:file, output:file, and
// trigger:file-change resolve through here too.
export function resolveConfigPath(path: string): string {
  if (isAbsolute(path)) return normalize(path);

  // resolve, not join: the result is absolute either way, so the file a config
  // names does not move when the process's working directory does.
  return resolve(configDir(), path);
}

export function configDir(): string {
  return globals.configDir ?? process.cwd();
}

// A trigger reuses its configured message on every firing, so a transform that
// mutates the message would otherwise write back into the config and the next
// firing would start from the last one's output.
export function cloneMessage(message: Message): Message {
  if (message === null || typeof message !== "object") return message;

  return structuredClone(message);
}

export default abstract class Step extends TypedConfigurable {
  declare config: StepConfig;
  task: Task;
  next?: Step;
  declare logPrefix: string;

  // `index` is the step's position in the task, supplied by Task.registerSteps;
  // a trigger has none. Recovering it here by reference identity fails for
  // every module whose defaults produce a new config object, which is what put
  // `.steps.-1` on those modules' log topics.
  constructor(config: StepConfig, task: Task, index?: number) {
    super(config);

    this.task = task;
    this.logPrefix = `${task.logPrefix}.${index === undefined ? "trigger" : `steps.${index}`}`;
  }

  // Every step interpolates against the same context, so a template that works
  // in one module works in all of them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateContext(additionalContext: Record<string, any> = {}) {
    const context = currentMessageContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged: Record<string, any> = {
      task: this.task,
      stash: context?.stash ?? {},
      module: this.config,
      env: process.env,
      globals: {
        ...globals,
        logger: undefined,
        // A Connection instance is not a plain object, so redact() would return
        // it untouched; project it first or ${globals.connections[0].config
        // .password} interpolates a live credential.
        connections: globals.connections?.map((connection) =>
          redact({
            name: connection.name,
            kind: connection.kind,
            subKind: connection.subKind,
            enabled: connection.enabled,
            config: connection.config,
          }),
        ),
      },
      message: context?.message,
      ...additionalContext,
    };

    if (merged.message === undefined) merged.message = NO_MESSAGE;

    return merged;
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
      const codePath = resolveConfigPath(config.codePath);
      let code;

      try {
        code = readFileSync(codePath, { encoding: "utf8" });
      } catch (error) {
        throw new Error(
          `Could not read codePath "${config.codePath}", resolved against the config directory "${configDir()}" to "${codePath}": ${(error as Error).message}.`,
        );
      }

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

  async endMessage(message: Message, traceId: string) {
    return this.task.endMessage(message, traceId);
  }

  async handleMessage(message: Message, traceId: string): Promise<Message> {
    // Task.startMessage normally opens the store; entering the chain at a step
    // directly opens one here, so a step always has a stash to write to.
    if (!currentMessageContext())
      return runWithMessageContext({ stash: {}, message, traceId }, () =>
        this.handleMessage(message, traceId),
      );

    // Keeps ${message} pointing at what this step was handed, for every step.
    const context = currentMessageContext();
    if (context) context.message = message;

    const startedAt = performance.now();
    const handled = await this.doHandleMessage(message, traceId);
    this.debug(
      `Handled message in ${(performance.now() - startedAt).toFixed(1)}ms.`,
      { topic: this.logPrefix, traceId },
      { type: this.config.type },
    );

    // transform:accumulate halts every message that does not complete a batch
    if (handled === HALT) return undefined;
    message = handled;

    if (context) context.message = message;

    if (this.next) {
      return this.next.handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    return message;
  }
}
