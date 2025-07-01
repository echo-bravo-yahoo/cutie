import { Loggable } from "./generic-loggable.js";
import Step from "./generic-step.js";
import Task from "./generic-task.js";

export interface ConnectionConfig {
  type: string;
  disabled: boolean;
}

export class Connection extends Loggable {
  type: string;
  subType: string;
  name: string;
  config: ConnectionConfig;
  task: Task;

  constructor(config: ConnectionConfig, task: Task) {
    super();

    if (config.type && config.type.includes(":")) {
      const typeInfo = Step.parseType(config.type);
      this.type = typeInfo.type;
      this.subType = typeInfo.subType;
      this.name = typeInfo.name;
    }

    this.config = config;
    this.task = task;
  }
}
