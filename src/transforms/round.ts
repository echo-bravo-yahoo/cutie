import Task from "../util/Task.js";
import Transform, {
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";

export interface RoundArgs {
  precision: number;
  direction: "up" | "down" | "round";
}

interface SinglePathRoundConfig extends RoundArgs, SingleConfig {}

interface MultiPathRoundConfig extends MultiConfig {
  paths: Record<string, RoundArgs>;
}

export type RoundConfig = SinglePathRoundConfig | MultiPathRoundConfig;

export default class Round extends Transform {
  constructor(config: RoundConfig, task: Task) {
    super(config, task, {});
  }

  transformSingle(
    value: number,
    config: SinglePathRoundConfig,
    _context: Context,
  ) {
    const integer = Math.floor(value);
    const fractional = value - integer;
    const precision = config.precision || 0;
    const intermediate = fractional * Math.pow(10, precision);
    let result;

    if (!config.direction || config.direction === "round") {
      result = integer + Math.round(intermediate) / Math.pow(10, precision);
    } else if (config.direction === "up") {
      result = integer + Math.ceil(intermediate) / Math.pow(10, precision);
    } else if (config.direction === "down") {
      result = integer + Math.floor(intermediate) / Math.pow(10, precision);
    } else {
      throw new Error(
        `Unrecognized direction "${config.direction}" for transform "round"; should be one of "up", "down", "round".`,
      );
    }

    return result;
  }
}

/*

single path form:
{
  "type": "transform:round",
  "path": "a.b.c",
  "precision": 2,
  "direction": "up"|"down"|"round"
}

multi-path form:
{
  "type": "transform:round",
  "paths": {
    "a.b.c": {
      "precision": 2,
      "direction": "up"|"down"|"round"
    }
  }
}
*/
