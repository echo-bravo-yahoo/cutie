import isArray from "lodash/isArray.js";
import get from "lodash/get.js";
import set from "lodash/set.js";

import Sensor from "../util/Sensor.js";
import Transformation, {
  Context,
  isMultiConfig,
  MultiConfig,
  TransformationConfig,
} from "../util/Transformation.js";
import Task from "../util/Task.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNumberArray(possibleArray: any): possibleArray is Array<number> {
  return (
    possibleArray !== undefined &&
    possibleArray !== null &&
    typeof possibleArray === "object" &&
    possibleArray.length !== undefined &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    possibleArray.every((value: any) => typeof value === "number")
  );
}

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

    if (!isNumberArray(oldValue))
      throw new Error(`Expected to find a number array but did not!`);

    const newValue = Sensor.doAggregation(oldValue, config.aggregation);
    if (context.current === "") {
      context.message.out = newValue;
    } else {
      if (typeof context.message.out === "object") {
        set(context.message.out, context.current, newValue);
      } else {
        throw new Error(`Expected to find an object!`);
      }
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
    if (!isArray(oldValue))
      throw new Error(`Aggregate attempting to operate on non-array value`);

    const newValue = Sensor.doAggregation(
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
      if (
        context.message &&
        typeof context.message === "object" &&
        context.message.out &&
        typeof context.message.out === "object"
      )
        set(context.message.out, context.current, newValue);
    }

    return newValue;
  }

  transformCompositeReadingArray(context: Context) {
    const oldArray = [
      ...get(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context.message.in as unknown as any,
        context.current,
        context.message.in
      ),
    ];
    const newSubObject = {};

    for (const path of Object.keys((this.config as MultiConfig).paths)) {
      context = {
        ...context,
        current: `${context.basePath ? `${context.basePath}.` : ""}${path}`,
        pathChosen: path,
      };
      const config =
        context.pathChosen && isMultiConfig(this.config)
          ? this.config.paths[context.pathChosen]
          : this.config;
      const newValue = Sensor.doAggregation(
        oldArray,
        config.aggregation,
        context.pathChosen
      );
      set(newSubObject, context.current, newValue);
    }

    if (context.basePath) {
      if (typeof context.message.out === "object") {
        set(context.message.out, context.basePath, newSubObject);
      } else {
        throw new Error(`Expected to find an object!`);
      }
    } else {
      context.message.out = newSubObject;
    }

    return newSubObject;
  }

  doTransformSingle(context: Context) {
    if (typeof context.message.out !== "object") {
      throw new Error(`Expected to find an object!`);
    }

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

    if (isArray(oldValue) && oldValue.length) {
      newValue = Sensor.doAggregation(oldValue, config.aggregation);
      set(context.message.out, context.current, newValue);
    } else {
      newValue = oldValue;
      set(context.message.out, context.current, newValue);
    }
  }

  // no-op for class composition reasons
  transformSingle(
    value: number,
    _config: TransformationConfig,
    _context: Context
  ) {
    return value;
  }
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
