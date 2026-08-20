import { exec } from "node:child_process";
import { promisify } from "node:util";

import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import {
  CODE_OUTPUT_TYPES,
  readCodeSource,
  requireOneCodeSource,
} from "../util/Step.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

const execAsync = promisify(exec);

export interface ShellConfig extends WholeMessageConfig {
  codePath: string;
  command: string;
  outputType: string;
  shellPath?: string;
}

export default class Shell extends Transform {
  declare config: ShellConfig;
  // transform() here replaces the base class's targeting entirely
  honorsTargeting = false;

  constructor(config: ShellConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    await super.register();
    requireOneCodeSource(this.config, "transform:shell");
  }

  async transform(message: Message, _traceId: string) {
    // A command line has no parameter channel, so the message reaches it by
    // being spliced into the text. interpolateConfigString stringifies
    // whatever it resolves, so a dotted path into the message works the same
    // way ${message} on its own does.
    const command = this.interpolateConfigString(
      readCodeSource(this.config, "transform:shell"),
      { message },
    );
    const args: Partial<Parameters<typeof execAsync>[1]> = {
      encoding: "utf8",
    };
    if (this.config.shellPath) args.shell = this.config.shellPath;

    // exec() rather than execSync(): a slow command (a multi-second render,
    // a network call) used to block this process's single thread entirely -
    // every other task sharing it, including one with a live HVAC feedback
    // loop, stalled for the full duration. This step is now async, so the
    // event loop keeps serving other tasks while a slow command runs.
    const { stdout } = await execAsync(command, args);
    if (this.config.outputType === "object")
      return JSON.parse(stdout as unknown as string);
    if (this.config.outputType === "string")
      // Only strip a newline the command actually emitted -- slicing the last
      // character unconditionally eats real output from commands without one.
      return String(stdout).replace(/\n$/, "");
    if (this.config.outputType === "number") return Number(stdout);

    // "any": whatever the command wrote, uncoerced.
    return stdout as unknown as Message;
  }

  // no-op
  transformSingle(value: number, _config: ShellConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:shell",
  description:
    "Replaces the message with the output of a shell command. The message is interpolated into the command before it runs.",
  options: {
    command: {
      type: "string",
      description:
        "The command to run. Give this or codePath, not both. Supports ${...} interpolation.",
      interpolated: true,
    },
    codePath: {
      type: "string",
      description:
        "A script file to run instead of an inline command, resolved against the config file's directory.",
      interpolated: true,
    },
    outputType: {
      type: "string",
      description:
        'What to turn the command\'s output into. "any" hands back the raw text.',
      required: true,
      enum: CODE_OUTPUT_TYPES,
    },
    shellPath: {
      type: "string",
      description:
        "Which shell to run the command in. Defaults to the system shell.",
    },
  },
};
