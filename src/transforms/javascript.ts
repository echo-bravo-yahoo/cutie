import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import {
  CODE_OUTPUT_TYPES,
  readCodeSource,
  requireOneCodeSource,
} from "../util/Step.js";
import { CompiledScript, compileScript } from "../util/javascript.js";
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
  private run!: CompiledScript;

  constructor(config: JavascriptConfig, task: Task, index?: number) {
    super(config as unknown as TransformConfig, task, index);
  }

  // Read and compiled here rather than per message, so a syntax error fails
  // this task once at registration instead of logging on every message
  // forever, and so an edited codePath needs a restart to take effect.
  async register() {
    await super.register();
    requireOneCodeSource(this.config, "transform:javascript");
    this.run = compileScript(
      readCodeSource(this.config, "transform:javascript"),
      "transform:javascript",
    );
  }

  transform(message: Message, _traceId: string) {
    const result = this.run(message, this.config, this.task);

    if (this.config.outputType === "string") return String(result);
    if (this.config.outputType === "number") return Number(result);
    // Parsed rather than passed through, so "object" means the same thing here
    // as it does for transform:shell, whose result is always text.
    if (this.config.outputType === "object")
      return typeof result === "string" ? JSON.parse(result) : result;

    // "any": whatever the script returned, uncoerced.
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
    "Replaces the message with what a JavaScript function returns. The source is compiled once, when the task registers, into a function taking message, stash, error, task, module, and env as arguments.",
  options: {
    command: {
      type: "string",
      description:
        "The body of the function, which must return its result. It receives message, stash, error, task, module, and env as arguments, so ${...} is JavaScript's own template syntax here rather than an interpolation. Give this or codePath, not both.",
    },
    codePath: {
      type: "string",
      description:
        "A script file to run instead of an inline body, resolved against the config file's directory and read once when the task registers.",
    },
    outputType: {
      type: "string",
      description:
        'What to turn the result into. "any" hands back whatever the function returned.',
      required: true,
      enum: CODE_OUTPUT_TYPES,
    },
  },
};
