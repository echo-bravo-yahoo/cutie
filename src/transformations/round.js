import { Transformation } from "../util/generic-transformation.js";

export default class Round extends Transformation {
  constructor(config) {
    super(config);
  }

  transform(message, inputModule) {
    return this.doTransformSingle(message, inputModule);
  }

  doTransformSingle(number, _inputModule) {
    const integer = Math.floor(number);
    const fractional = number - integer;
    const precision = this.config.precision || 0;
    const intermediate = fractional * Math.pow(10, precision);
    let result;

    if (!this.config.direction || this.config.direction === "round") {
      result = integer + Math.round(intermediate) / Math.pow(10, precision);
    } else if (this.config.direction === "up") {
      result = integer + Math.ceil(intermediate) / Math.pow(10, precision);
    } else if (this.config.direction === "down") {
      result = integer + Math.floor(intermediate) / Math.pow(10, precision);
    } else {
      throw new Error(
        `Unrecognized direction "${this.config.direction}" for transformation "round"; should be one of "up", "down", "round".`
      );
    }

    return result;
  }
}

/*
{
  "type": "round",
  "path": "",
  "precision": "2",
  "direction": "up"|"down"|"round"
}
*/
