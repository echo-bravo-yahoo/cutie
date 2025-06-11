import { Transformation } from "../util/generic-transformation.js";

export default class Round extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, context) {
    const integer = Math.floor(value);
    const fractional = value - integer;
    const precision = config.precision || 0;
    const intermediate = fractional * Math.pow(10, precision);
    let result;

    if (!config.direction || config.direction === "round") {
      result = integer + Math.round(intermediate) / Math.pow(10, precision);
    } else if (config.direction === "up") {
      result = integer + Math.ceil(intermediate) / Math.pow(10, precision);
    } else if (config.direction === "down") {
      result = integer + Math.floor(intermediate) / Math.pow(10, precision);
    } else {
      throw new Error(
        `Unrecognized direction "${config.direction}" for transformation "round"; should be one of "up", "down", "round".`
      );
    }

    // console.log(
    //   `ROUND::: context: ${JSON.stringify(context)}, value: ${JSON.stringify(value)}, config: ${JSON.stringify(config)}, result: ${result}`
    // );
    return result;
  }
}

/*

single path form:
{
  "type": "transformation:round",
  "path": "a.b.c",
  "precision": 2,
  "direction": "up"|"down"|"round"
}

multi-path form:
{
  "type": "transformation:round",
  "paths": {
    "a.b.c": {
      "precision": 2,
      "direction": "up"|"down"|"round"
    }
  }
}
*/
