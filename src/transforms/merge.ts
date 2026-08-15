import isArray from "lodash/isArray.js";
import mergeWith from "lodash/mergeWith.js";

import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface MergeConfig extends WholeMessageConfig {
  arrayStrategy?: "replace" | "concat";
  sources: Array<string | Record<string, Message>>;
}

export default class Merge extends Transform {
  declare config: MergeConfig;

  constructor(config: MergeConfig, task: Task) {
    super(config, task);
  }

  transform(message: Message, _traceId: string) {
    if (typeof message !== "object") return message;
    return mergeWith(
      message,
      ...this.config.sources.map((source) => {
        if (typeof source === "object") {
          return source;
        } else {
          return this.interpolatePath(source);
        }
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (objValue: any, srcValue: any) =>
        isArray(objValue)
          ? this.config.arrayStrategy === "concat"
            ? objValue.concat(srcValue)
            : srcValue
          : undefined,
    );
  }

  // never-called / no-op for class composition reasons
  transformSingle(value: number, _config: MergeConfig, _context: Context) {
    return value;
  }
}

/*
{
  "type": "transform:merge",
  "sources": Array<string>, // gets interpolated
  "arrayStrategy": "replace" | "concat" // defaults to "replace"
}
 */
