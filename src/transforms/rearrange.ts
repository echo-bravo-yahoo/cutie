import get from "lodash/get.js";
import set from "lodash/set.js";
import unset from "lodash/unset.js";

import Transform, {
  Context,
  isMultiConfig,
  MultiConfig,
  isSingleConfig,
  SingleConfig,
  TransformConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface RearrangeArgs {
  to: string;
}

interface SinglePathRearrangeConfig extends RearrangeArgs, SingleConfig {}

interface MultiPathRearrangeConfig extends MultiConfig {
  paths: Record<string, RearrangeArgs>;
}

export type RearrangeConfig =
  | SinglePathRearrangeConfig
  | MultiPathRearrangeConfig;

function isSinglePathRearrangeConfig(
  config: TransformConfig,
): config is SinglePathRearrangeConfig {
  return (
    isSingleConfig(config) && typeof (config as unknown as any).to === "string"
  );
}

export default class Rearrange extends Transform {
  constructor(config: RearrangeConfig, task: Task) {
    super(config, task, {});
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
    const newValue = this.transformSingle(oldValue, config, context);

    if (!context.message.out && typeof context.message.in === "object") {
      context.message.out = { ...context.message.in };
    }

    // this is for cases where we want to take a primitive and move it into an object
    if (isSinglePathRearrangeConfig(this.config) && this.config.to !== ".") {
      context.message.out = {};
    }

    if (config.to) {
      // delete the value at the old path before we add it at the new path
      unset(context.message.out, context.current);
    }

    if (typeof context.message.out !== "object")
      throw new Error(
        `Context.message.out should be an object, but instead is ${context.message.out} (${typeof context.message.out}).`,
      );
    set(context.message.out, config.to || context.current, newValue);
  }

  transformSingle(
    value: Message,
    _config: SinglePathRearrangeConfig,
    _context: Context,
  ) {
    return value;
  }
}

/*

single path form:
{
  "type": "transform:rearrange",
  "path": "a.b.c",
  "to": "a.d"
}

multi-path form:
{
  "type": "transform:rearrange",
  "paths": {
    "a.b.c": {
      "to": "a.d"
    }
  }
}
*/
