import { Transformation } from "../util/generic-transformation.js";

export default class Offset extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, _context) {
    // console.log(
    //   `OFFSET::: value: ${value}, config: ${JSON.stringify(config)}, result: ${value + config.offset}`
    // );
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
