import get from "lodash/get.js";

import { globals } from "../index.js";
import Task from "./Task.js";
import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";

export interface StepConfig extends TypedConfig {}

export default abstract class Step extends TypedConfigurable {
  declare config: StepConfig;
  task: Task;
  next?: Step;
  declare logPrefix: string;

  constructor(config: StepConfig, task: Task) {
    super(config);

    this.task = task;
    const index =
      task && task.steps && task.steps.findIndex((step) => step === this);
    this.logPrefix = `core.runtime.tasks.${task.name}.steps.${index}`;
    // TO-DO: why in the WORLD is this necessary?
    // TypedConfigurable already sets this but for some reason,
    // it's dropped by the time we get to here in tests
    this.config = config;
  }

  // always includes the context of task, module/config, and globals
  interpolateConfigString(
    template: string,
    additionalContext?: Record<string, any>,
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

  // TO-DO: implement some callback behavior here
  async endMessage(message: any, _traceId?: string) {
    return message;
  }

  async handleMessage(message: any, traceId?: string): Promise<any> {
    message = await this.doHandleMessage(message, traceId);

    if (this.next) {
      return this.next.handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  async doHandleMessage(message: any, _traceId?: string): Promise<string> {
    return message;
  }
}
