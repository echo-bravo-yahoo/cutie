import { Loggable } from "./generic-loggable.js";
import { Step } from "./generic-step.js";

export class Connection extends Loggable {
  constructor(config, task) {
    super();

    if (config.type && config.type.includes(":")) {
      const typeInfo = Step.parseTypeString(config.type);
      this.type = typeInfo.type;
      this.subType = typeInfo.subType;
      this.name = typeInfo.name;
    }

    this.config = config;
    this.task = task;
    this.stateKey = config.name || config.type;
  }
}
