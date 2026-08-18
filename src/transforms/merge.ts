import isArray from "lodash/isArray.js";
import mergeWith from "lodash/mergeWith.js";

import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface MergeConfig extends WholeMessageConfig {
  arrayStrategy?: "replace" | "concat";
  sources: Array<string | Record<string, Message>>;
}

export default class Merge extends Transform {
  declare config: MergeConfig;
  // transform() here replaces the base class's targeting entirely
  honorsTargeting = false;

  constructor(config: MergeConfig, task: Task, index?: number) {
    super(config, task, index);
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

export const schema: ModuleSchema = {
  type: "transform:merge",
  description:
    "Merges values into the message. A source may be a literal object or a $$-prefixed path to look one up.",
  options: {
    sources: {
      type: "array",
      description:
        'What to merge in, in order. Each entry is either an object or a "$$"-prefixed path such as "$$stash.device".',
      required: true,
      interpolated: true,
    },
    arrayStrategy: {
      type: "string",
      description: "What to do when both sides hold an array at the same key.",
      default: "replace",
      enum: ["replace", "concat"],
    },
  },
};
