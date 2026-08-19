import isArray from "lodash/isArray.js";
import get from "lodash/get.js";
import set from "lodash/set.js";

import { OptionSchema, UNIVERSAL_OPTIONS } from "./schema.js";
import Step, { HALT, StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

// `paths` is the general form and `path` is shorthand for a single-entry
// `paths`; `basePath` names an array to walk. A transform that replaces
// transform() outright consults none of them.
const TARGETING_OPTIONS = ["path", "paths", "basePath"];

function describeValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (isArray(value)) return "an array";
  if (typeof value === "object") return "an object";

  return `a ${typeof value}`;
}

// some notes on terminology:
// a primitive reading is one where the reading is a primitive/literal
//   e.g., message is of type number | Array<number>
// a simple reading is one where the reading is an object and we want one key from that object
//   e.g., message is of type object
//         get(message, path) is of type number
// a composite reading is one where the reading is an object and we want multiple keys from that object
//   e.g., message is of type object
//         get(message, path) is of type number, and we'll do it repeatedly
// a basePath points to an array to iterate through
// a path pulls a value from one of the iterables in the basePath
export type TransformConfig = SingleConfig | MultiConfig | WholeMessageConfig;

interface BaseTransformConfig extends StepConfig {
  type: string;
  basePath?: string;
}

export interface SingleConfig extends BaseTransformConfig {
  path: string;
}

export interface MultiConfig extends BaseTransformConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paths: Record<string, any>;
}

export interface WholeMessageConfig extends BaseTransformConfig {}

export function isSingleConfig(
  config: TransformConfig,
): config is SingleConfig {
  return typeof (config as SingleConfig).path === "string" ? true : false;
}

export function isMultiConfig(config: TransformConfig): config is MultiConfig {
  return typeof (config as MultiConfig).paths === "object" ? true : false;
}

// The three targeting options read the same way in every transform that honors
// them; only the verb changes. Per-path arguments deliberately carry no schema
// default: a default would be injected at the top level and then collide with
// the multi-path form, where every argument belongs inside `paths`.
export function targetingOptions(verb: string): Record<string, OptionSchema> {
  return {
    path: {
      type: "string",
      description: `Which value in the message to ${verb}. Omit to ${verb} the whole message.`,
    },
    paths: {
      type: "object",
      description: `Several values to ${verb} at once, each mapped to its own arguments.`,
    },
    basePath: {
      type: "string",
      description: `An array in the message to ${verb} one entry at a time.`,
    },
  };
}

// Joins a target path onto the position being walked, so that "" stays "" and
// a walked entry keeps its index: ("readings[0]", "temp") => "readings[0].temp".
function joinPath(current: string, path?: string) {
  if (!path) return current;

  return current ? `${current}.${path}` : path;
}

export interface Context {
  message: { in: Message; out?: Message };
  basePath?: string;
  path?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paths?: Record<string, any>;
  current: string;
  pathChosen?: string;
  // Where the array being collapsed whole lives, set only when walksArrays is
  // false and there is an array to collapse. Its presence is what tells
  // doTransformSingle to hand the array itself to transformSingle, and what
  // tells a transform that `path` names a key inside each entry rather than a
  // place in the output.
  arrayPath?: string;
}

export default abstract class Transform extends Step {
  declare config: TransformConfig;
  // Set false by a transform that overrides transform() without calling super,
  // so it drives the whole message itself and the targeting options mean
  // nothing to it. transform:munge overrides transform() but does call super,
  // so it stays true.
  honorsTargeting = true;
  // Whether an array at the target is a list to map over or data to collapse.
  // transform:aggregate is the one that collapses.
  walksArrays = true;
  // TO-DO: value's type here is probably string|number|undefined
  abstract transformSingle(
    value: Message,
    config: Message,
    context: Context,
  ): Message;

  constructor(config: TransformConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // A schema describes top-level options, so it cannot see inside `paths`. A
  // module with per-path arguments walks these at registration and checks both
  // forms the same way. `path` is "" for the single-path and whole-message
  // forms.
  eachTargetArgs(): Array<{ path: string; args: Record<string, unknown> }> {
    if (isMultiConfig(this.config))
      return Object.entries(this.config.paths ?? {}).map(([path, args]) => ({
        path,
        args: (args ?? {}) as Record<string, unknown>,
      }));

    return [
      { path: "", args: this.config as unknown as Record<string, unknown> },
    ];
  }

  // Checked at registration rather than in the constructor, because a
  // subclass's honorsTargeting is not assigned until after super() returns.
  async register() {
    const config = this.config as unknown as Record<string, unknown>;

    if (!this.honorsTargeting) {
      for (const option of TARGETING_OPTIONS)
        if (config[option] !== undefined)
          throw new Error(
            `"${this.config.type}" does not accept "${option}"; it transforms the whole message.`,
          );

      return;
    }

    if (config.path !== undefined && config.paths !== undefined)
      throw new Error(
        `"${this.config.type}": "path" cannot be combined with "paths".`,
      );

    if (config.paths === undefined) return;

    // In the multi-path form every per-path option belongs inside `paths`; one
    // left at the top level is read by nothing.
    const stray = Object.keys(config).find(
      (key) =>
        !UNIVERSAL_OPTIONS.includes(key) && !TARGETING_OPTIONS.includes(key),
    );

    if (stray !== undefined)
      throw new Error(
        `"${this.config.type}": "${stray}" cannot be combined with "paths".`,
      );
  }

  // widened past `transform`'s own return so a subclass may halt the chain
  async doHandleMessage(
    message: Message,
    traceId: string,
  ): Promise<Message | typeof HALT> {
    return this.transform(message, traceId);
  }

  determineInitialMessageOut(
    isArrayOfReadings: boolean,
    hasBasePath: boolean,
    isPrimitiveReading: boolean,
    messageIn: Message,
  ) {
    // A collapsed array writes one value at a named path rather than an entry
    // per element, so it starts from an object even with no basePath.
    if (isArrayOfReadings) return hasBasePath || !this.walksArrays ? {} : [];
    if (isPrimitiveReading) return undefined;

    return messageIn;
  }

  transform(message: Message, traceId: string) {
    // Without this the array walkers return early and the message collapses to
    // {}, which reads as "the transform did nothing" rather than "basePath is
    // pointed at the wrong place".
    if (this.config.basePath !== undefined) {
      const target = get(message, this.config.basePath);

      if (!isArray(target))
        throw new Error(
          `"${this.config.type}": "basePath" "${this.config.basePath}" should point at an array, but found ${describeValue(target)}.`,
        );
    }

    const isArrayOfReadings = !!(
      this.config.basePath !== undefined ||
      (isArray(message) && message.length)
    );
    const isSimpleReading = isSingleConfig(this.config);
    const isCompositeReading = isMultiConfig(this.config);
    const isPrimitiveReading = !isSimpleReading && !isCompositeReading;

    const context: Context = {
      message: {
        in: message,
        out: this.determineInitialMessageOut(
          isArrayOfReadings,
          !!this.config.basePath,
          isPrimitiveReading,
          message,
        ),
      },
      basePath: this.config.basePath,
      path: (this.config as SingleConfig).path,
      paths: (this.config as MultiConfig).paths,
      current: this.config.basePath || "",
      arrayPath:
        isArrayOfReadings && !this.walksArrays
          ? this.config.basePath || ""
          : undefined,
    };

    this.debug(
      "Transforming message.",
      { traceId },
      {
        isArrayOfReadings,
        isSimpleReading,
        isCompositeReading,
        isPrimitiveReading,
        context,
      },
    );

    // A primitive reading and a simple one differ only in whether `path` is
    // set, which joinPath already handles, so both take transformOne.
    const step = isCompositeReading ? this.transformEach : this.transformOne;

    if (isArrayOfReadings && this.walksArrays) {
      this.walkArray(context, step);
    } else {
      step.call(this, context);
    }

    this.debug(
      "Transformed message.",
      { traceId },
      {
        context: {
          in: context.message.in,
          out: context.message.out,
        },
      },
    );

    return context.message.out;
  }

  doTransformSingle(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    const oldValue = get(
      context.message.in,
      context.arrayPath ?? context.current,
      context.message.in,
    );
    const newValue = this.transformSingle(oldValue, config, context);

    if (context.current === "") {
      context.message.out = newValue;
    } else {
      if (
        typeof context.message !== "object" ||
        context.message.out === undefined
      )
        context.message.out = {};
      set(context.message.out as unknown as object, context.current, newValue);
    }
  }

  // Runs `step` once per entry of the array at the current position, with
  // `current` moved onto that entry.
  walkArray(context: Context, step: (context: Context) => void) {
    const array = get(context.message.in, context.current, context.message.in);
    if (!isArray(array)) return;

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      step.call(this, context);
    }
  }

  // The whole message, or the one value `path` names. A collapsed array writes
  // at the array's own position, because there `path` names a key inside each
  // entry; with no basePath there is no such position, so `path` names one.
  transformOne(context: Context) {
    this.doTransformSingle({
      ...context,
      current:
        context.arrayPath === undefined
          ? joinPath(context.current, context.path)
          : context.current || context.path || "",
    });
  }

  // One target per `paths` entry, each written under the current position.
  transformEach(context: Context) {
    for (const path of Object.keys((this.config as MultiConfig).paths || {})) {
      this.doTransformSingle({
        ...context,
        current: joinPath(context.current, path),
        pathChosen: path,
      });
    }
  }
}
