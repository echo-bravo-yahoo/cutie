import get from "lodash/get.js";
import set from "lodash/set.js";
import unset from "lodash/unset.js";

import { Transformation } from "../util/generic-transformation.js";

export default class Rearrange extends Transformation {
  constructor(config) {
    super(config);
  }

  transformSingle(value, config, context) {
    return value;
  }

  doTransformSingle(context) {
    const config = context.pathChosen
      ? this.config.paths[context.pathChosen]
      : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in,
    );
    const newValue = this.transformSingle(oldValue, config, context);

    // console.log(
    //   "Context before transforming single value",
    //   JSON.stringify(context, null, 2)
    // );
    if (!context.message.out) context.message.out = { ...context.message.in };
    if (config.to) {
      // delete the value at the old path before we add it at the new path
      unset(context.message.out, context.current);
    }
    set(context.message.out, config.to || context.current, newValue);
    // console.log(
    //   "Context after transforming single value",
    //   JSON.stringify(context, null, 2)
    // );
  }

  transformSingle(value, _config, _context) {
    return value;
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
