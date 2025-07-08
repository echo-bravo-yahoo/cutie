import get from "lodash/get.js";
import set from "lodash/set.js";
import unset from "lodash/unset.js";

import Transformation, {
  Context,
  isMultiConfig,
  MultiConfig,
  SingleConfig,
} from "../util/generic-transformation.js";
import Task from "../util/generic-task.js";

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

export default class Rearrange extends Transformation {
  constructor(config: RearrangeConfig, task: Task) {
    super(config, task);
  }

  doTransformSingle(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in
    );
    const newValue = this.transformSingle(oldValue, config, context);

    if (!context.message.out) context.message.out = { ...context.message.in };
    if (config.to) {
      // delete the value at the old path before we add it at the new path
      unset(context.message.out, context.current);
    }
    set(context.message.out, config.to || context.current, newValue);
  }

  transformSingle(value: any, _config: any, _context: Context) {
    return value;
  }
}

/*

single path form:
{
  "type": "transformation:rearrange",
  "path": "a.b.c",
  "to": "a.d"
}

multi-path form:
{
  "type": "transformation:rearrange",
  "paths": {
    "a.b.c": {
      "to": "a.d"
    }
  }
}
*/
