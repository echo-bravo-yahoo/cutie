import Task from "../util/generic-task.js";
import Transformation, {
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/generic-transformation.js";

export interface OffsetArgs {
  offset: number;
}

interface SinglePathOffsetConfig extends OffsetArgs, SingleConfig {}

interface MultiPathOffsetConfig extends MultiConfig {
  paths: Record<string, OffsetArgs>;
}

export type OffsetConfig = SinglePathOffsetConfig | MultiPathOffsetConfig;

export default class Offset extends Transformation {
  constructor(config: OffsetConfig, task: Task) {
    super(config, task);
  }

  transformSingle(value: any, config: any, _context: Context) {
    return value + config.offset;
  }
}

/*
single path form:
{
  "type": "transformation:offset",
  "path": "",
  "offset": -5
}

multi-path form:
{
  "type": "transformation:offset",
  "paths": {
    "a.b.c": {
      "offset": -5
    }
  }
}
*/
