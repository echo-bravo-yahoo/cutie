import * as vm from "node:vm";
import { readFileSync } from "node:fs";
import { normalize, join } from "node:path";

import Transformation, {
  Context,
  TransformationConfig,
  WholeMessageConfig,
} from "../util/generic-transformation.js";
import { srcDir } from "../index.js";
import Task from "../util/generic-task.js";

export interface JavascriptConfig extends WholeMessageConfig {
  codePath: string;
  command: string;
  outputType: "object" | "string" | "number";
}

export default class Javascript extends Transformation {
  declare config: JavascriptConfig;

  constructor(config: JavascriptConfig, task: Task) {
    super(config as unknown as TransformationConfig, task);
  }

  // TO-DO: functionally a copy of generateCommand in src/transformations/shell.js
  generateCode(message: any) {
    if (this.config.codePath) {
      const codePath = normalize(join(srcDir, "..", this.config.codePath));
      return readFileSync(codePath, { encoding: "utf8" });
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
        `Configuration should either specify a codePath or a command.`
      );
    }
  }

  transform(message: any) {
    const code = this.generateCode(message);
    const context = vm.createContext({ message });
    const script = new vm.Script(code);

    return script.runInContext(context);
  }

  // no-op for class composition reasons
  transformSingle(value: any, config: any, context: Context) {}
}

/*
whole message form:
{
  "type": "transformation:javascript",
  "codePath": ""
}
*/
