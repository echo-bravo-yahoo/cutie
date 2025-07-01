import get from "lodash/get.js";
import set from "lodash/set.js";

import Transformation, {
  Context,
  isMultiConfig,
  MultiConfig,
  SingleConfig,
} from "../util/generic-transformation.js";
import Task from "../util/generic-task.js";

export interface PluckArgs {
  destination: string;
}

interface SinglePathPluckConfig extends PluckArgs, SingleConfig {}

interface MultiPathPluckConfig extends MultiConfig {
  paths: Record<string, PluckArgs>;
}

export type PluckConfig = SinglePathPluckConfig | MultiPathPluckConfig;

export default class Pluck extends Transformation {
  declare config: PluckConfig;

  constructor(config: PluckConfig, task: Task) {
    super(config, task);

    this.preservePaths = false;
  }

  doTransformSingle(context: Context) {
    const config: PluckArgs =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : (this.config as SinglePathPluckConfig);
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in
    );
    const newValue = this.transformSingle(oldValue, config, context);

    if (!context.message.out) context.message.out = {};
    if (config.destination === ".") {
      context.message.out = newValue;
    } else {
      set(context.message.out, config.destination || context.current, newValue);
    }
  }

  transformSingle(value: any, _config: any, _context: Context) {
    return value;
  }
}

/*
single path form:
{
  "type": "transformation:pluck",
  "path": "",
  "destination": ""
}

multi-path form:
{
  "type": "transformation:pluck",
  "paths": {
    "a.b.c": {
      "destination": ""
    }
  }
}
*/
