import * as vm from "node:vm";
import { readFileSync } from 'node:fs';
import { normalize, join } from 'node:path'

import { Transformation } from "../util/generic-transformation.js";
import { srcDir } from "../index.js";

export default class Javascript extends Transformation {
  constructor(config) {
    super(config);
  }

  transform(message) {
    const context = vm.createContext({ message });
    const codePath = normalize(join(srcDir, "..", this.config.codePath));
    const code = readFileSync(codePath, { encoding: "utf8" });
    const script = new vm.Script(code);

    return script.runInContext(context);
  }
}

/*
whole message form:
{
  "type": "transformation:javascript",
  "codePath": ""
}
*/
