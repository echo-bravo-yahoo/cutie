import get from "lodash/get.js";
import keys from "lodash/keys.js";
import set from "lodash/set.js";
import unset from "lodash/unset.js";

import Transform, {
  targetingOptions,
  Context,
  isMultiConfig,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export type MungeArgsWithTo = {
  op: "duplicate" | "rename";
  to: string;
};
export interface MungeArgsWithoutTo {
  op: "remove" | "retain";
}
export type MungeOp = MungeArgsWithTo["op"] | MungeArgsWithoutTo["op"];

const MUNGE_OPS: ReadonlyArray<MungeOp> = [
  "duplicate",
  "rename",
  "remove",
  "retain",
];

const OPS_NEEDING_TO: ReadonlyArray<MungeOp> = ["duplicate", "rename"];

export type MungeArgs = MungeArgsWithTo | MungeArgsWithoutTo;

export type SinglePathMungeConfig =
  | (MungeArgsWithTo & SingleConfig)
  | (MungeArgsWithoutTo & SingleConfig);

interface MultiPathMungeConfig extends MultiConfig {
  paths: Record<string, MungeArgs>;
}

export type MungeConfig = SinglePathMungeConfig | MultiPathMungeConfig;

export default class Munge extends Transform {
  declare untouched: Set<string>;

  constructor(config: MungeConfig, task: Task, index?: number) {
    super(config, task, index);

    this.untouched = new Set();
  }

  // `to` is required by two of the four ops and meaningless to the other two,
  // which no single option's schema can say. Without this, a missing `to` wrote
  // a key literally named "undefined".
  async register() {
    await super.register();

    for (const { path, args } of this.eachTargetArgs()) {
      const where = path ? ` at path "${path}"` : "";
      const op = args.op as MungeOp | undefined;

      if (!MUNGE_OPS.includes(op as MungeOp))
        throw new Error(
          `"transform:munge": "op" is ${JSON.stringify(op)}${where}, which is not one of: ${MUNGE_OPS.join(", ")}.`,
        );

      if (OPS_NEEDING_TO.includes(op as MungeOp) && args.to === undefined)
        throw new Error(
          `"transform:munge": "op" is "${op}"${where}, which needs a "to" naming where the value goes.`,
        );
    }
  }

  transform(message: Message, traceId: string) {
    if (typeof message === "object") this.untouched = new Set(keys(message));
    let result = super.transform(message, traceId);

    if (isMultiConfig(this.config) && this.config.paths["*"]) {
      this.untouched.forEach((path) => {
        result = this.mungeMessageOut(
          result,
          path,
          (this.config as MultiConfig).paths["*"],
          get(message, path),
        );
      });
    }

    return result;
  }

  handleUnwrap(
    oldValue: Message,
    context: Context,
    config: SinglePathMungeConfig,
  ) {
    context.message.out = undefined;
    if (config.op === "rename") context.message.out = oldValue;
  }

  handleWrap(context: Context) {
    context.message.out = {};
  }

  mungeMessageOut(
    message: Message,
    current: string,
    config: SinglePathMungeConfig,
    oldValue: Message,
  ) {
    if (typeof message !== "object") return;
    if (config.op === "retain") {
      set(message, current, oldValue);
    } else if (config.op === "rename") {
      unset(message, current);
      set(message, (config as MungeArgsWithTo & SingleConfig).to, oldValue);
    } else if (config.op === "duplicate") {
      set(message, (config as MungeArgsWithTo & SingleConfig).to, oldValue);
    } else if (config.op === "remove") {
      unset(message, current);
    }

    return message;
  }

  doTransformSingle(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in,
    );
    this.untouched.delete(context.current);
    if (context.current === "*") return;
    if (config.to === ".") return this.handleUnwrap(oldValue, context, config);
    if (context.current === ".") {
      this.handleWrap(context);
    }

    this.mungeMessageOut(
      context.message.out,
      context.current,
      config,
      oldValue,
    );
  }

  // never called, just exists to satisfy bad types
  transformSingle(
    value: Message,
    _config: SinglePathMungeConfig,
    _context: Context,
  ) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:munge",
  description:
    'Moves, copies, keeps, or drops keys of the message. A "*" path in the multi-path form applies to every key no other path mentions.',
  options: {
    ...targetingOptions("munge"),
    op: {
      type: "string",
      description:
        "What to do with the key: copy it to a second place, move it, drop it, or keep it while other keys are dropped.",
      enum: MUNGE_OPS,
    },
    to: {
      type: "string",
      description:
        'Where the value goes. Required by "duplicate" and "rename"; unused by the others.',
    },
  },
};
