import set from "lodash/set.js";
import merge from "lodash/merge.js";

import { Transformation } from "../util/generic-transformation.js";

export default class Merge extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, context) {
    let result = { ...context.message };
    const merged = merge(value, config);
    if (config.to === "") {
      result = merged;
      context.current = "";
    } else {
      set(result, context.pathChosen, merged);
    }
    return result;
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
