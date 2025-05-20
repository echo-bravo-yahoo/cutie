import { Sensor } from "../util/generic-sensor.js";
import { Transformation } from "../util/generic-transformation.js";

export default class Aggregate extends Transformation {
  constructor(config) {
    super(config);
  }

  // TODO: confirm that inputModule is a Sensor?
  transform(message, inputModule) {
    return this.transformSet(message, inputModule, this.config.aggregations);
  }

  doTransformSingle(value, aggregation) {
    return Sensor.doAggregation(value, aggregation);
  }
}

/*
{
  "type": "aggregate",
  "aggregations": {
    "path.to.aggregate": "latest|average|median|pX"
  }
}
*/
