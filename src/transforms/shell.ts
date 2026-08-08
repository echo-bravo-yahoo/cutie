import { execSync } from "node:child_process";
import { join, normalize } from "node:path";
import { readFileSync } from "node:fs";

import { srcDir } from "../index.js";
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
    super(config, task, {});
  }

  // TODO: functionally a copy of generateCode in src/transforms/javascript.js
  generateCommand(message: Message) {
    if (this.config.codePath) {
      const codePath = normalize(join(srcDir, "..", this.config.codePath));
      const code = readFileSync(codePath, { encoding: "utf8" });
      return typeof message !== "string"
        ? this.interpolateConfigString(code, {
            message: JSON.stringify(message),
          })
        : this.interpolateConfigString(code, { message });
    } else if (this.config.command) {
      if (this.config.outputType === "object") {
        return this.interpolateConfigString(this.config.command, {
          message: JSON.stringify(message),
        });
      } else {
        return this.interpolateConfigString(this.config.command, { message });
      }
    } else {
      throw new Error(
        `Configuration should either specify a codePath or a command.`,
      );
    }
  }

  transform(message: Message) {
    const command = this.generateCommand(message);
    const args: Partial<Parameters<typeof execSync>[1]> = {
      encoding: "utf8",
    };
    if (this.config.shellPath) args.shell = this.config.shellPath;

    const result = execSync(command, args);
    if (this.config.outputType === "object") {
      return JSON.parse(result as unknown as string);
    } else if (this.config.outputType === "string") {
      return String(result.slice(0, -1));
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
