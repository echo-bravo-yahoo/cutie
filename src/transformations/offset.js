import get from "lodash/get.js";
import set from "lodash/set.js";

import { Transformation } from "../util/generic-transformation.js";

export default class Offset extends Transformation {
  constructor(config) {
    super(config);
  }

  doTransformSingle(context) {
    const config = context.pathChosen
      ? this.config.paths[context.pathChosen]
      : this.config;

    const oldValue = get(context.message, context.current, context.message);
    const newValue = oldValue + config.offset;
    set(context.message, context.current, newValue);

    return newValue;
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
