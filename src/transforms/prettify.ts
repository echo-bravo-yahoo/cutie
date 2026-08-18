import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface PrettifyConfig extends WholeMessageConfig {
  spaces?: number;
  parseInput?: boolean;
}

export default class Prettify extends Transform {
  declare config: PrettifyConfig;
  // transform() here replaces the base class's targeting entirely
  honorsTargeting = false;

  constructor(config: PrettifyConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  transform(message: Message, _traceId: string) {
    if (typeof message === "string" && this.config.parseInput) {
      return JSON.stringify(JSON.parse(message), null, this.config.spaces);
    } else if (typeof message === "object") {
      return JSON.stringify(message, null, this.config.spaces);
    } else {
      return message;
    }
  }

  // no-op
  transformSingle(value: number, _config: PrettifyConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:prettify",
  description:
    "Replaces the message with its JSON text, indented for reading. transform:uglify is the same thing with no indentation.",
  options: {
    spaces: {
      type: "number",
      description: "How many spaces to indent each level by.",
      default: 4,
      min: 0,
      integer: true,
    },
    parseInput: {
      type: "boolean",
      description:
        "Treat a string message as JSON and re-indent it, rather than quoting it as a string.",
      default: false,
    },
  },
};
