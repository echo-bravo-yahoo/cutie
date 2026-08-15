import Task from "../util/Task.js";
import Transform, {
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";

export interface OffsetArgs {
  offset: number;
}

interface SinglePathOffsetConfig extends OffsetArgs, SingleConfig {}

interface MultiPathOffsetConfig extends MultiConfig {
  paths: Record<string, OffsetArgs>;
}

export type OffsetConfig = SinglePathOffsetConfig | MultiPathOffsetConfig;

export default class Offset extends Transform {
  constructor(config: OffsetConfig, task: Task) {
    super(config, task);
  }

  transformSingle(
    value: number,
    config: SinglePathOffsetConfig,
    _context: Context,
  ) {
    return value + config.offset;
  }
}

/*
single path form:
{
  "type": "transform:offset",
  "path": "",
  "offset": -5
}

multi-path form:
{
  "type": "transform:offset",
  "paths": {
    "a.b.c": {
      "offset": -5
    }
  }
}
*/
