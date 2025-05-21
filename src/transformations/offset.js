import { Transformation } from "../util/generic-transformation.js";

export default class Offset extends Transformation {
  constructor(config) {
    super(config);
  }

  doTransformSingle(value, config) {
    return value + config.offset;
  }
}

/*
single path form:
{
  "type": "offset",
  "path": "",
  "offset": -5
}

multi-path form:
{
  "type": "offset",
  "paths": {
    "path.through.JSON.object": {
      "offset": -5
    }
  }
}
*/
