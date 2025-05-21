import get from "lodash/get.js";
import set from "lodash/set.js";

import { Sensor } from "../util/generic-sensor.js";
import { Transformation } from "../util/generic-transformation.js";

export default class Aggregate extends Transformation {
  constructor(config) {
    super(config);
  }

  transformPrimitiveReadingArray(context) {
    const config = context.pathChosen
      ? this.config.paths[context.pathChosen]
      : this.config;

    const oldValue = get(context.message, context.current, context.message);
    const newValue = Sensor.doAggregation(oldValue, config.aggregation);
    set(context.message, context.current, newValue);

    return newValue;
  }

  transformSimpleReadingArray(context) {
    const config = context.pathChosen
      ? this.config.paths[context.pathChosen]
      : this.config;

    console.log("context", context);
    const oldValue = get(context.message, context.current, context.message);
    console.log("oldValue", oldValue);
    let newValue = Sensor.doAggregation(
      oldValue,
      config.aggregation,
      context.path
    );
    console.log("newValue", newValue);
    if (context.current) {
      set(context.message, context.current, newValue);
    } else {
      newValue = set({}, context.path, newValue);
    }

    return newValue;
  }

  transformCompositeReadingArray(context) {}

  doTransformSingle(value, aggregation) {
    if (value.length) {
      return Sensor.doAggregation(value, aggregation);
    } else {
      return value;
    }
  }
}

/*
single path form:
{
  "type": "aggregate",
  "path": "",
  "aggregation": "latest|average|median|pX"
}

{
  "type": "aggregate",
  "paths": {
    "path.to.aggregate": { "aggregation": "latest|average|median|pX" }
  }
}
*/
