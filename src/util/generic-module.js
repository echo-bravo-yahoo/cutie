import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import { Loggable } from "./generic-loggable.js";

export class Module extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.stateKey = config.name || config.type;
  }

  async transform(message) {
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

      result = await transformer.transform(result, this);
    }

    return result;
  }
}
