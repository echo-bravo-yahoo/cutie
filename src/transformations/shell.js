import { execSync } from "node:child_process";

import { Transformation } from "../util/generic-transformation.js";

export default class Shell extends Transformation {
  constructor(config) {
    super(config);
  }

  transform(message) {
    let command;
    if (this.config.outputType === "object") {
      command = this.interpolateConfigString(this.config.command, { message: JSON.stringify(message) });
    } else {
      command = this.interpolateConfigString(this.config.command, { message });
    }

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
