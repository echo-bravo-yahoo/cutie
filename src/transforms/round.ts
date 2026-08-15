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
    const precision = config.precision || 0;
    // Scale via exponent notation so 21.005 -> 2100.5 rather than 2100.4999...
    const scaled = Number(`${value}e${precision}`);
    let result;

    if (!config.direction || config.direction === "round") {
      result = Number(`${Math.round(scaled)}e-${precision}`);
    } else if (config.direction === "up") {
      result = Number(`${Math.ceil(scaled)}e-${precision}`);
    } else if (config.direction === "down") {
      result = Number(`${Math.floor(scaled)}e-${precision}`);
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
