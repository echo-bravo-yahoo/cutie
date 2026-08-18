import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface UglifyConfig extends WholeMessageConfig {
  parseInput?: boolean;
}

export default class Uglify extends Transform {
  declare config: UglifyConfig;
  // transform() here replaces the base class's targeting entirely
  honorsTargeting = false;

  constructor(config: UglifyConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // "spaces" is what separates prettify from uglify, so accepting it here would
  // be accepting a request for the other module.
  async register() {
    await super.register();

    if ((this.config as { spaces?: unknown }).spaces !== undefined)
      throw new Error(
        `"transform:uglify" does not accept "spaces"; it is "transform:prettify" with no indentation. Use "transform:prettify" with a "spaces" of 0 to say so explicitly.`,
      );
  }

  transform(message: Message, _traceId: string) {
    if (typeof message === "string" && this.config.parseInput) {
      return JSON.stringify(JSON.parse(message), null, 0);
    } else if (typeof message === "object") {
      return JSON.stringify(message, null, 0);
    } else {
      return message;
    }
  }

  // no-op
  transformSingle(value: number, _config: UglifyConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:uglify",
  description:
    "Replaces the message with its JSON text on one line. transform:prettify with a spaces of 0 does the same thing.",
  options: {
    parseInput: {
      type: "boolean",
      description:
        "Treat a string message as JSON and re-encode it, rather than quoting it as a string.",
      default: false,
    },
  },
};
