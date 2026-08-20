import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import get from "lodash/get.js";

import { globals } from "./globals.js";
import { Module, ModuleConfig } from "./Module.js";
import { redact } from "./redact.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

export interface TaskModuleConfig extends ModuleConfig {}

// What `${message}` resolves to before any message exists, which is every
// interpolation a trigger performs. Without it the template would stringify
// undefined and splice the text "undefined" into a topic or a path.
export const NO_MESSAGE = "(no message)";

// A template that is the whole string, rather than one spliced into text. The
// inner class excludes "}" so that "${a} ${b}" is two templates, not one.
const WHOLE_TEMPLATE = /^\$\{([^}]*)\}$/;

export interface CodeConfig {
  codePath?: string;
  command?: string;
}

// What a code transform may coerce its result to. "any" hands back whatever the
// code produced.
export const CODE_OUTPUT_TYPES = ["object", "string", "number", "any"];

// readCodeSource prefers codePath and ignores command when both are set, so
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

// The text a code transform was configured with, raw. What happens to it next
// differs by transform: shell interpolates it, because a command line has no
// other channel to the message, and javascript compiles it with the same names
// bound as parameters instead.
export function readCodeSource(config: CodeConfig, type: string): string {
  if (config.codePath) {
    const codePath = resolveConfigPath(config.codePath);

    try {
      return readFileSync(codePath, { encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `Could not read codePath "${config.codePath}", resolved against the config directory "${configDir()}" to "${codePath}": ${(error as Error).message}.`,
      );
    }
  }

  if (config.command) return config.command;

  throw new Error(`"${type}" needs either a "codePath" or a "command".`);
}

// What ${error...} resolves to. Set only on a message a task was invoked to
// handle a failure with, so an ordinary chain leaves every ${error...} path
// resolving to nothing.
export interface ErrorContext {
  // The error's own message and constructor name.
  message: string;
  name: string;
  // Where it happened: the task it was handling a message for, the log topic
  // of the step that threw, and that step's module type.
  task: string;
  step: string;
  type: string;
}

export interface MessageContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stash: Record<string, any>;
  // The message as it stands at the current step, not as the trigger produced
  // it, so ${message} means the same thing everywhere.
  message: Message;
  traceId?: string;
  error?: ErrorContext;
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

// A module a task owns rather than the runtime: a trigger or a step. The
// message-shaped surface -- interpolation against the in-flight message, and
// the code a transform runs -- lives here because a trigger needs it without
// being in the chain.
export default abstract class TaskModule extends Module {
  declare config: TaskModuleConfig;
  task: Task;
  declare logPrefix: string;

  // `index` is the step's position in the task, supplied by Task.registerSteps;
  // a trigger has none. Recovering it here by reference identity fails for
  // every module whose defaults produce a new config object, which is what put
  // `.steps.-1` on those modules' log topics.
  constructor(config: TaskModuleConfig, task: Task, index?: number) {
    super(config);

    this.task = task;
    this.logPrefix = `${task.logPrefix}.${index === undefined ? "trigger" : `steps.${index}`}`;
  }

  // Names the failure and where it happened, for the log line the runtime
  // writes and for the ${error...} namespace a rescue task interpolates
  // against.
  errorContext(error: unknown): ErrorContext {
    // Duck-typed rather than `instanceof Error`: transform:javascript runs its
    // code in a vm context, which has an Error constructor of its own, so what
    // it throws is an error without being an instance of this realm's.
    const thrown = error as Partial<Error> | undefined;

    return {
      message:
        typeof thrown?.message === "string" ? thrown.message : String(error),
      name: typeof thrown?.name === "string" ? thrown.name : typeof error,
      task: this.task.name,
      step: this.logPrefix,
      type: this.config.type,
    };
  }

  // A task's `disabled` reaches everything the task owns, its trigger
  // included, so disabling a task stops it firing rather than merely emptying
  // its chain.
  shouldEnable(): boolean {
    return super.shouldEnable() && this.task.config.disabled !== true;
  }

  // Every module interpolates against the same context, so a template that
  // works in one module works in all of them.
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
      error: context?.error,
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
      str.replace(/\${(.*?)}/g, (_x, path) => {
        const value = get(obj, path);
        // A resolved primitive splices as itself; anything else needs
        // JSON.stringify, or an object would splice in as "[object Object]".
        // JSON.stringify(undefined) is the value undefined, not a string, so
        // a missing path still falls back to the literal text "undefined".
        if (typeof value === "string") return value;
        return JSON.stringify(value) ?? "undefined";
      });

    const result = inject(template, this.generateContext(additionalContext));

    return result;
  }

  // Interpolates every string reachable from a config-supplied value, not just
  // a top-level one, so a message can be an object with interpolated fields.
  //
  // A string that is exactly one ${path} yields the value with its type intact,
  // which is how a source can be an object or a number rather than its
  // stringification. A ${...} inside longer text splices, because text is what
  // the surrounding characters need.
  interpolateDeep(
    value: Message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additionalContext?: Record<string, any>,
  ): Message {
    if (typeof value === "string") {
      const whole = WHOLE_TEMPLATE.exec(value);
      const resolved = whole
        ? get(this.generateContext(additionalContext), whole[1])
        : undefined;

      // A path that resolves to nothing falls through to the splice, so a
      // template naming something absent reads the same either way.
      if (resolved !== undefined) return resolved;

      return this.interpolateConfigString(value, additionalContext);
    }
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
}
