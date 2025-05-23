import { Transformation } from "../util/generic-transformation.js";

export default class Offset extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, _context) {
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
    "a.b.c": {
      "offset": -5
    }
  }
}
*/
