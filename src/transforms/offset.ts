import Task from "../util/Task.js";
import Transform, {
  targetingOptions,
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";
import { ModuleSchema } from "../util/schema.js";

export interface OffsetArgs {
  offset: number;
}

interface SinglePathOffsetConfig extends OffsetArgs, SingleConfig {}

interface MultiPathOffsetConfig extends MultiConfig {
  paths: Record<string, OffsetArgs>;
}

export type OffsetConfig = SinglePathOffsetConfig | MultiPathOffsetConfig;

export default class Offset extends Transform {
  constructor(config: OffsetConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  transformSingle(
    value: number,
    config: SinglePathOffsetConfig,
    _context: Context,
  ) {
    return value + config.offset;
  }
}

export const schema: ModuleSchema = {
  type: "transform:offset",
  description: "Adds a fixed amount to a number.",
  options: {
    ...targetingOptions("offset"),
    offset: {
      type: "number",
      description: "How much to add. A negative value subtracts.",
    },
  },
};
