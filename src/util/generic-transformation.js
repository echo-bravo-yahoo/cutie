import set from "lodash/set.js";

import { Loggable } from "./generic-loggable.js";

export class Transformation extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.stateKey = config.name || config.type;
  }

  transform(message, inputModule) {
    const value = get(message, this.config.path || "", message);
    const transformed = this.doTransform(value, inputModule);
    if (typeof message === "object") {
      return set(message, this.config.path, transformed);
    } else {
      return transformed;
    }
  }
}
