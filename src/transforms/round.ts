import Task from "../util/Task.js";
import Transform, {
  targetingOptions,
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";
import { ModuleSchema } from "../util/schema.js";

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
  constructor(config: RoundConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  transformSingle(
    value: number,
    config: SinglePathRoundConfig,
    _context: Context,
  ) {
    // `??`, not `||`: a configured precision of 0 means round to an integer.
    const precision = config.precision ?? 0;
    // Scale via exponent notation so 21.005 -> 2100.5 rather than 2100.4999...
    const scaled = Number(`${value}e${precision}`);
    let result;

    if (!config.direction || config.direction === "round") {
      result = Number(`${Math.round(scaled)}e-${precision}`);
    } else if (config.direction === "up") {
      result = Number(`${Math.ceil(scaled)}e-${precision}`);
    } else {
      // The schema's enum has already ruled out anything but these three.
      result = Number(`${Math.floor(scaled)}e-${precision}`);
    }

    return result;
  }
}

export const schema: ModuleSchema = {
  type: "transform:round",
  description: "Rounds a number to a given number of decimal places.",
  options: {
    ...targetingOptions("round"),
    precision: {
      type: "number",
      description:
        "How many decimal places to keep. Zero rounds to an integer, which is also what omitting it does.",
      min: 0,
      integer: true,
    },
    direction: {
      type: "string",
      description: "Which way to break a tie. Defaults to nearest.",
      enum: ["up", "down", "round"],
    },
  },
};
