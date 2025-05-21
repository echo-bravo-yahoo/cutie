import { Sensor } from "../util/generic-sensor.js";
import { Transformation } from "../util/generic-transformation.js";

export default class Aggregate extends Transformation {
  constructor(config) {
    super(config);
  }

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
    "path.to.aggregate": "latest|average|median|pX"
  }
}
*/
