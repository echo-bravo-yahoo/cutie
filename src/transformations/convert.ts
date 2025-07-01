import Task from "../util/generic-task.js";
import Transformation, {
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/generic-transformation.js";

export interface ConvertArgs {
  from: "celsius" | "fahrenheit";
  to: "celsius" | "fahrenheit";
}

interface SinglePathConvertConfig extends ConvertArgs, SingleConfig {}

interface MultiPathConvertConfig extends MultiConfig {
  paths: Record<string, ConvertArgs>;
}

export type ConvertConfig = SinglePathConvertConfig | MultiPathConvertConfig;

export default class Convert extends Transformation {
  constructor(config: ConvertConfig, task: Task) {
    super(config, task);
  }

  transformSingle(value: any, config: any, context: Context) {
    let result;
    if (config.from === "celsius" && config.to === "fahrenheit") {
      result = (9 / 5) * value + 32;
    } else if (config.from === "fahrenheit" && config.to === "celsius") {
      result = (5 / 9) * (value - 32);
    } else {
      throw new Error(
        `Unknown conversion from "${config.from}" to "${config.to}" in config at path "${context.current}".`
      );
    }

    return result;
  }
}

/*
single path form:
{
  "type": "transformation:convert",
  "path": "a.b.c",
  "from": celsius,
  "to": fahrenheit
}

multi-path form:
{
  "type": "transformation:convert",
  "paths": {
    "a.b.c": {
      "convert": {
        "from": celsius,
        "to": fahrenheit
      }
    }
  }
}
*/
