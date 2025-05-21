import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import get from "lodash/get.js";

import { Loggable } from "./generic-loggable.js";
import { globals } from "../index.js";

export class Module extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.stateKey = config.name || config.type;
  }

  async runAllTransformations(message) {
    let result = message;

    for (let transformationConfig of this.config.transformations) {
      const Transformation = (
        await import(
          normalize(
            `${__dirname}/../transformations/${transformationConfig.type}.js`
          )
        )
      ).default;
      const transformer = new Transformation(transformationConfig);

      result = transformer.transform(result, this);
    }

    return result;
  }

  interpolateConfigString(template) {
    const inject = (str, obj) =>
      str.replace(/\${(.*?)}/g, (_x, path) => get(obj, path));

    return inject(template, {
      module: this.config,
      globals: { ...globals, logger: undefined },
    });
  }
}
