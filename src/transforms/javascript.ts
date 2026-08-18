import * as vm from "node:vm";

import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { CODE_OUTPUT_TYPES, requireOneCodeSource } from "../util/Step.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface JavascriptConfig extends WholeMessageConfig {
  codePath: string;
  command: string;
  outputType: "object" | "string" | "number" | "any";
}

export default class Javascript extends Transform {
  declare config: JavascriptConfig;
  // transform() here replaces the base class's targeting entirely
  honorsTargeting = false;

  constructor(config: JavascriptConfig, task: Task, index?: number) {
    super(config as unknown as TransformConfig, task, index);
  }

  async register() {
    await super.register();
    requireOneCodeSource(this.config, "transform:javascript");
  }

  transform(message: Message, _traceId: string) {
    const code = this.generateCode(this.config, message);
    const context = vm.createContext({ message });
    const script = new vm.Script(code);
    const result = script.runInContext(context);

    if (this.config.outputType === "string") return String(result);
    if (this.config.outputType === "number") return Number(result);
    // Parsed rather than passed through, so "object" means the same thing here
    // as it does for transform:shell, whose result is always text.
    if (this.config.outputType === "object")
      return typeof result === "string" ? JSON.parse(result) : result;

    // "any": whatever the script evaluated to, uncoerced.
    return result;
  }

  // no-op for class composition reasons
  transformSingle(value: number, _config: JavascriptConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:javascript",
  description:
    "Replaces the message with the result of a JavaScript expression, evaluated with the message in scope.",
  options: {
    command: {
      type: "string",
      description:
        "The expression to evaluate. Give this or codePath, not both.",
      interpolated: true,
    },
    codePath: {
      type: "string",
      description:
        "A script file to evaluate instead of an inline expression, resolved against the config file's directory.",
      interpolated: true,
    },
    outputType: {
      type: "string",
      description:
        'What to turn the result into. "any" hands back whatever the expression evaluated to.',
      required: true,
      enum: CODE_OUTPUT_TYPES,
    },
  },
};
