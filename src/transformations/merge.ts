import set from "lodash/set.js";
import merge from "lodash/merge.js";

import Transformation, {
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/generic-transformation.js";
import Task from "../util/generic-task.js";

export interface MergeArgs {
  to: string;
}

interface SinglePathMergeConfig extends MergeArgs, SingleConfig {}

interface MultiPathMergeConfig extends MultiConfig {
  paths: Record<string, MergeArgs>;
}

export type MergeConfig = SinglePathMergeConfig | MultiPathMergeConfig;

export default class Merge extends Transformation {
  constructor(config: MergeConfig, task: Task) {
    super(config, task);
  }

  transformSingle(value: any, config: any, context: Context) {
    let result = { ...context.message };
    const merged = merge(value, config);
    if (config.to === "") {
      result = merged;
      context.current = "";
    } else {
      if (!context.pathChosen) throw new Error(`???`);
      set(result, context.pathChosen, merged);
    }
    return result;
  }
}

/*

single path form:
{
  "type": "transformation:merge",
  "path": "a.b.c",
  "to": "a.d"
}

multi-path form:
{
  "type": "transformation:merge",
  "paths": {
    "a.b.c": {
      "to": "a.d"
    }
  }
}
*/
