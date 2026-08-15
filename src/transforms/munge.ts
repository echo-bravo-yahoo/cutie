import get from "lodash/get.js";
import keys from "lodash/keys.js";
import set from "lodash/set.js";
import unset from "lodash/unset.js";

import Transform, {
  Context,
  isMultiConfig,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export type MungeArgsWithTo = {
  op: "duplicate" | "rename";
  to: string;
};
export interface MungeArgsWithoutTo {
  op: "remove" | "retain";
}
export type MungeOp = MungeArgsWithTo["op"] | MungeArgsWithoutTo["op"];

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

  constructor(config: MungeConfig, task: Task) {
    super(config, task, {});

    this.untouched = new Set();
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

/*

single path form:
{
  "type": "transform:munge",
  "path": "a.b.c",
  "op": "duplicate" | "rename" | "remove" | "retain",
  "to": "a.d" // required for "duplicate" and "rename"
}

multi-path form:
{
  "type": "transform:munge",
  "paths": {
    "a.b.c": {
      "op": "rename",
      "to": "a.d"
    }
  }
}
*/
