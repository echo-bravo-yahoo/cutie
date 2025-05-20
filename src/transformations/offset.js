import { Transformation } from "../util/generic-transformation.js";

export default class Offset extends Transformation {
  constructor(config) {
    super(config);
  }

  transform(message, inputModule) {
    return this.transformSet(message, inputModule, this.config.offsets);
  }

  doTransformSingle(value, offset) {
    return value + offset;
  }
}

/*
{
  "type": "offset",
  "offsets": {
    "path.through.JSON.object": -5
  }
}
*/
