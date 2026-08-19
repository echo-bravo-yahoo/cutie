import isArray from "lodash/isArray.js";

import { doAggregation } from "../util/aggregation.js";
import Transform, { targetingOptions, Context } from "../util/Transform.js";
import { ModuleSchema } from "../util/schema.js";
import { Message } from "../util/type-helpers.js";

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

export default class Aggregate extends Transform {
  // An array is the data to collapse, not a list of readings to map over,
  // which is the whole point of this transform.
  walksArrays = false;

  transformSingle(value: Message, config: Message, context: Context): Message {
    if (!isArray(value) || !value.length) return value;

    // Set only when an array of readings was collapsed whole, and then it is
    // the key to read out of each reading rather than a place in the output.
    const key =
      context.arrayPath === undefined
        ? undefined
        : (context.pathChosen ?? context.path);

    if (key === undefined && !isNumberArray(value))
      throw new Error(`Expected to find a number array but did not!`);

    return doAggregation(
      value,
      (config as { aggregation: string }).aggregation,
      key,
    );
  }
}

export const schema: ModuleSchema = {
  type: "transform:aggregate",
  description:
    "Collapses an array of readings into one value. The other half of a batching task, after transform:accumulate has gathered the array.",
  options: {
    ...targetingOptions("aggregate"),
    aggregation: {
      type: "string",
      description:
        'How to collapse the values: "latest", "average", "sum", "median", or "pN" for any percentile.',
    },
  },
};
