import get from "lodash/get.js";
import set from "lodash/set.js";

import Sensor from "../util/generic-sensor.js";
import Transformation, {
  Context,
  isMultiConfig,
  MultiConfig,
  TransformationConfig,
} from "../util/generic-transformation.js";
import Task from "../util/generic-task.js";

export default class Aggregate extends Transformation {
  constructor(config: TransformationConfig, task: Task) {
    super(config, task);
  }

  transformPrimitiveReadingArray(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    let oldValue;

    if (context.current === "") {
      oldValue = context.message.in;
    } else {
      oldValue = get(context.message.in, context.current, context.message.in);
    }
    const newValue = Sensor.doAggregation(oldValue, config.aggregation);
    if (context.current === "") {
      context.message.out = newValue;
    } else {
      set(context.message.out, context.current, newValue);
    }

    return newValue;
  }

  transformSimpleReadingArray(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    let oldValue;

    if (context.current === "") {
      oldValue = context.message.in;
    } else {
      oldValue = get(context.message.in, context.current, context.message.in);
    }
    let newValue = Sensor.doAggregation(
      oldValue,
      config.aggregation,
      context.path
    );
    if (context.current === "") {
      if (context.path === undefined)
        throw new Error(
          `Need either context.current or context.path to be defined.`
        );
      context.message.out = set({}, context.path, newValue);
    } else {
      set(context.message.out, context.current, newValue);
    }

    return newValue;
  }

  transformCompositeReadingArray(context: Context) {
    const oldArray = [
      ...get(context.message.in, context.current, context.message.in),
    ];
    const newSubObject = {};

    for (let path of Object.keys((this.config as MultiConfig).paths)) {
      context = {
        ...context,
        current: `${context.basePath ? `${context.basePath}.` : ""}${path}`,
        pathChosen: path,
      };
      const config =
        context.pathChosen && isMultiConfig(this.config)
          ? this.config.paths[context.pathChosen]
          : this.config;
      let newValue = Sensor.doAggregation(
        oldArray,
        config.aggregation,
        context.pathChosen
      );
      set(newSubObject, context.current, newValue);
    }

    if (context.basePath) {
      set(context.message.out, context.basePath, newSubObject);
    } else {
      context.message.out = newSubObject;
    }

    return newSubObject;
  }

  doTransformSingle(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in
    );
    let newValue;

    if (oldValue.length) {
      newValue = Sensor.doAggregation(oldValue, config.aggregation);
      set(context.message.out, context.current, newValue);
    } else {
      newValue = oldValue;
      set(context.message.out, context.current, newValue);
    }
  }

  // no-op for class composition reasons
  transformSingle(_value: any, _config: any, _context: Context) {}
}

/*
single path form:
{
  "type": "transformation:aggregate",
  "path": "a.b.c",
  "aggregation": "latest|average|median|pX"
}

multi-path form:
{
  "type": "transformation:aggregate",
  "paths": {
    "a.b.c": { "aggregation": "latest|average|median|pX" }
  }
}
*/
