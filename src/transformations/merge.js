import set from "lodash/set.js";
import merge from "lodash/merge.js";

import { Transformation } from "../util/generic-transformation.js";

export default class Merge extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, _context) {
    return merge(value, config);
  }
}

/*

single path form:
{
  "type": "transformation:merge",
  "path": "a.b.c",
  "to": "a.d"
}

multi-path form:
{
  "type": "transformation:merge",
  "paths": {
    "a.b.c": {
      "to": "a.d"
    }
  }
}
*/
