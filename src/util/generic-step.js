import get from "lodash/get.js";

import { globals } from "../index.js";
import { Loggable } from "./generic-loggable.js";

export class Step extends Loggable {
  constructor(config, task) {
    super();

    this.config = config;
    this.task = task;

    if (config.type && config.type.includes(":")) {
      const typeInfo = Step.parseTypeString(config.type);
      this.type = typeInfo.type;
      this.subType = typeInfo.subType;
      this.name = typeInfo.name;
    }

    this.stateKey = config.name || config.type;
  }

  static parseTypeString(typeString) {
    const parts = typeString.split(":");
    return {
      type: parts[0],
      subType: parts[1],
      name: parts[2],
    };
  }

  register() {
    // TODO: no-op to satisfy tasks.js::registerTasks()
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
