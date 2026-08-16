import { execSync } from "node:child_process";

import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface ShellConfig extends WholeMessageConfig {
  codePath: string;
  command: string;
  outputType: string;
  shellPath?: string;
}

export default class Shell extends Transform {
  declare config: ShellConfig;

  constructor(config: ShellConfig, task: Task) {
    super(config, task);
  }

  transform(message: Message, _traceId: string) {
    const command = this.generateCode(this.config, message);
    const args: Partial<Parameters<typeof execSync>[1]> = {
      encoding: "utf8",
    };
    if (this.config.shellPath) args.shell = this.config.shellPath;

    const result = execSync(command, args);
    if (this.config.outputType === "object") {
      return JSON.parse(result as unknown as string);
    } else if (this.config.outputType === "string") {
      // Only strip a newline the command actually emitted -- slicing the last
      // character unconditionally eats real output from commands without one.
      return String(result).replace(/\n$/, "");
    } else if (this.config.outputType === "number") {
      return Number(result);
    } else {
      throw new Error(`Invalid outputType: ${this.config.outputType}`);
    }
  }

  // no-op
  transformSingle(value: number, _config: ShellConfig, _context: Context) {
    return value;
  }
}

/*
full object form:
{
  "type": "transform:shell",
  "command": "node -e console.log(\"\")",
  "outputType": "string"|"number"|"object"
}
*/
