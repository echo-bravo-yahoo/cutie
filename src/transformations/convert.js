import { Transformation } from "../util/generic-transformation.js";

export default class Convert extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, context) {
    if (config.from === "celsius" && config.to === "fahrenheit") {
      return (9 / 5) * value + 32;
    } else if (config.from === "fahrenheit" && config.to === "celsius") {
      return (5 / 9) * (value - 32);
    } else {
      throw new Error(
        `Unknown conversion from "${config.from}" to "${config.to}" in config at path "${context.current}".`
      );
    }
  }
}

/*
single path form:
{
  "type": "convert",
  "path": "a.b.c",
  "from": celsius,
  "to": fahrenheit
}

multi-path form:
{
  "type": "convert",
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
