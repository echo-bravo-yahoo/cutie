import Transform, {
  Context,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface UglifyConfig extends WholeMessageConfig {
  parseInput?: boolean;
}

export default class Uglify extends Transform {
  declare config: UglifyConfig;

  constructor(config: UglifyConfig, task: Task) {
    super(config, task, {});
  }

  addDefaultsToConfig(config: UglifyConfig): UglifyConfig {
    return {
      parseInput: false,
      ...config,
    };
  }

  transform(message: Message) {
    if (typeof message === "string" && this.config.parseInput) {
      return JSON.stringify(JSON.parse(message), null, 0);
    } else if (typeof message === "object") {
      return JSON.stringify(message, null, 0);
    } else {
      return message;
    }
  }

  // no-op
  transformSingle(value: number, _config: UglifyConfig, _context: Context) {
    return value;
  }
}

/*
full object form:
{
  "type": "transform:uglify",
  "parseInput": false
}
*/
