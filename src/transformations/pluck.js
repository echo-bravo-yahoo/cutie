import get from "lodash/get.js";
import set from "lodash/set.js";

import { Transformation } from "../util/generic-transformation.js";

export default class Pluck extends Transformation {
  constructor(config) {
    super(config);

    this.preservePaths = false;
  }

  doTransformSingle(context) {
    const config = context.pathChosen
      ? this.config.paths[context.pathChosen]
      : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in
    );
    const newValue = this.transformSingle(oldValue, config, context);

    // console.log(
    //   "Context before transforming single value",
    //   JSON.stringify(context, null, 2)
    // );
    if (!context.message.out) context.message.out = {};
    if (this.config.destination === ".") {
      context.message.out = newValue;
    } else {
      set(context.message.out, config.destination || context.current, newValue);
    }
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
  "type": "transformation:pluck",
  "path": "",
  "destination": ""
}

multi-path form:
{
  "type": "transformation:pluck",
  "paths": {
    "a.b.c": {
      "destination": ""
    }
  }
}
*/
