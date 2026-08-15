import * as vm from "node:vm";

import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface JavascriptConfig extends WholeMessageConfig {
  codePath: string;
  command: string;
  outputType: "object" | "string" | "number";
}

export default class Javascript extends Transform {
  declare config: JavascriptConfig;

  constructor(config: JavascriptConfig, task: Task) {
    super(config as unknown as TransformConfig, task, {});
  }

  transform(message: Message) {
    const code = this.generateCode(this.config, message);
    const context = vm.createContext({ message });
    const script = new vm.Script(code);
    const result = script.runInContext(context);

    if (this.config.outputType === "string") return String(result);
    if (this.config.outputType === "number") return Number(result);
    return result;
  }

  // no-op for class composition reasons
  transformSingle(value: number, _config: JavascriptConfig, _context: Context) {
    return value;
  }
}

/*
{
  "type": "transform:javascript",
  "codePath": "",
  "command": ""
  "outputType": "object" | "string" | "number";
}
*/
