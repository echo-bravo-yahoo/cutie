import get from "lodash/get.js";
import set from "lodash/set.js";

import { Loggable } from "./generic-loggable.js";

export class Transformation extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.stateKey = config.name || config.type;
  }

  transformSet(message, inputModule, pathToOptions) {
    for (let [path, options] of Object.entries(pathToOptions)) {
      const original = get(message, path);
      const transformed = this.doTransformSingle(original, options);
      message = set(message, path, transformed);
    }

    // TODO: this is probably not the right place for this
    // but it's here for legacy reasons for right now
    inputModule.samples = [];
    return message;
  }

  transformSingle(message, inputModule) {
    const value = get(message, this.config.path || "", message);
    const transformed = this.doTransformSingle(value, inputModule);
    if (typeof message === "object") {
      return set(message, this.config.path, transformed);
    } else {
      return transformed;
    }
  }
}
