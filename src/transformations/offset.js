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
  "type": "transformation:offset",
  "path": "",
  "offset": -5
}

multi-path form:
{
  "type": "transformation:offset",
  "paths": {
    "a.b.c": {
      "offset": -5
    }
  }
}
*/
