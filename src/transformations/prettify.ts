import Transformation, {
  Context,
  WholeMessageConfig,
} from "../util/Transformation.js";
import Task from "../util/Task.js";

export interface PrettifyConfig extends WholeMessageConfig {
  spaces?: number;
  parseInput?: boolean;
}

export default class Prettify extends Transformation {
  declare config: PrettifyConfig;

  constructor(config: PrettifyConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: PrettifyConfig): PrettifyConfig {
    return {
      spaces: 4,
      parseInput: false,
      ...config,
    };
  }

  transform(message: any) {
    if (typeof message === "string" && this.config.parseInput) {
      return JSON.stringify(JSON.parse(message), null, this.config.spaces);
    } else if (typeof message === "object") {
      return JSON.stringify(message, null, this.config.spaces);
    } else {
      return message;
    }
  }

  // no-op
  transformSingle(value: number, _config: any, _context: Context) {
    return value;
  }
}

/*
full object form:
{
  "type": "transformation:prettify",
  "spaces": 4,
  "parseInput": false
}
*/
