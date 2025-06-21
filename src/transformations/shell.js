import { execSync } from "node:child_process";
import { join, normalize } from "node:path";
import { readFileSync } from "node:fs";

import { srcDir } from "../index.js";
import { Transformation } from "../util/generic-transformation.js";

export default class Shell extends Transformation {
  constructor(config) {
    super(config);
  }

  // TO-DO: functionally a copy of generateCode in src/transformations/javascript.js
  generateCommand(message) {
    if (this.config.codePath) {
      const codePath = normalize(join(srcDir, "..", this.config.codePath));
      const code = readFileSync(codePath, { encoding: "utf8" });
      return typeof message !== "string"
        ? this.interpolateConfigString(code, { message: JSON.stringify(message) })
        : this.interpolateConfigString(code, { message });
    } else if (this.config.command) {
      if (this.config.outputType === "object") {
        return this.interpolateConfigString(this.config.command, { message: JSON.stringify(message) });
      } else {
        return this.interpolateConfigString(this.config.command, { message });
      }
    } else {
      throw new Error(`Configuration should either specify a codePath or a command.`);
    }
  }

  transform(message) {
    let command = this.generateCommand(message);

    const result = execSync(command, { encoding: "utf8" })
    if (this.config.outputType === "object") {
      return JSON.parse(result);
    } else if (this.config.outputType === "string") {
      return String(result.slice(0,-1));
    } else if (this.config.outputType === "number") {
      return Number(result);
    } else {
      throw new Error(`Invalid outputType: ${this.config.outputType}`);
    }
  }
}

/*
full object form:
{
  "type": "transformation:shell",
  "command": "node -e console.log(\"\")",
}
*/
