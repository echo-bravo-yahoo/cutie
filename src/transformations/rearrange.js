import set from "lodash/set.js";

import { Transformation } from "../util/generic-transformation.js";

export default class Rearrange extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, context) {
    let result = { ...context.message };
    if (config.to === "") {
      result = value;
      context.current = "";
    } else {
      set(result, context.pathChosen, undefined);
      set(result, config.to, value);
    }
    return result;
  }
}

/*

single path form:
{
  "type": "transformation:rearrange",
  "path": "a.b.c",
  "to": "a.d"
}

multi-path form:
{
  "type": "transformation:rearrange",
  "paths": {
    "a.b.c": {
      "to": "a.d"
    }
  }
}
*/
