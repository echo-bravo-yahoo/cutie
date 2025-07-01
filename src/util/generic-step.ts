import get from "lodash/get.js";

import { globals } from "../index.js";
import { Loggable } from "./generic-loggable.js";
import Task from "./generic-task.js";

export interface StepConfig {
  type: string;
}

export default abstract class Step extends Loggable {
  type: string;
  subType: string;
  name: string;
  config: StepConfig;
  task: Task;
  next?: Step;
  abstract handleMessage(message: any): Promise<any>;

  constructor(config: StepConfig, task: Task) {
    super();

    this.config = config;
    this.task = task;

    if (config.type && config.type.includes(":")) {
      const typeInfo = Step.parseType(config.type);
      this.type = typeInfo.type;
      this.subType = typeInfo.subType;
      this.name = typeInfo.name;
    }
  }

  static parseType(type: string) {
    const parts = type.split(":");
    return {
      type: parts[0],
      subType: parts[1],
      name: parts[2],
    };
  }

  register() {
    // no-op to satisfy tasks.js::registerTasks()
  }

  // always includes the context of task, module/config, and globals
  interpolateConfigString(
    template: string,
    additionalContext?: Record<string, any>
  ) {
    const inject = (str: string, obj: Record<string, any>) =>
      str.replace(/\${(.*?)}/g, (_x, path) => get(obj, path));

    const result = inject(template, {
      task: this.task,
      module: this.config,
      globals: { ...globals, logger: undefined },
      ...additionalContext,
    });

    return result;
  }
}
