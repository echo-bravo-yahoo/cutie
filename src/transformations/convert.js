import { Transformation } from "../util/generic-transformation.js";

export default class Convert extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, context) {
    let result;
    if (config.from === "celsius" && config.to === "fahrenheit") {
      result = (9 / 5) * value + 32;
    } else if (config.from === "fahrenheit" && config.to === "celsius") {
      result = (5 / 9) * (value - 32);
    } else {
      throw new Error(
        `Unknown conversion from "${config.from}" to "${config.to}" in config at path "${context.current}".`,
      );
    }

    // console.log(
    //   `CONVERT::: context: ${JSON.stringify(context)}, value: ${value}, config: ${JSON.stringify(config)}, result: ${result}`
    // );
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
