import get from "lodash/get.js";

import { globals } from "../index.js";
import Task from "./Task.js";
import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";
import { Message } from "./type-helpers.js";
import { ConfigurableImplementation } from "./Configurable.js";

export interface StepConfig extends TypedConfig {}

export default abstract class Step extends TypedConfigurable {
  declare config: StepConfig;
  task: Task;
  next?: Step;
  declare logPrefix: string;

  constructor(
    config: StepConfig,
    task: Task,
    implementation?: ConfigurableImplementation,
  ) {
    super(config, implementation);

    this.task = task;
    const index = task.config.steps.findIndex((step) => step === this.config);
    this.logPrefix = `${this.task.logPrefix}.steps.${index}`;
  }

  // always includes the context of task, module/config, and globals
  interpolateConfigString(
    template: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additionalContext?: Record<string, any>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inject = (str: string, obj: Record<string, any>) =>
      str.replace(/\${(.*?)}/g, (_x, path) => get(obj, path));

    const result = inject(template, {
      task: { ...this.task, stash: undefined },
      // we present stash like it's _not_ stored on the task
      stash: this.task.stash,
      module: this.config,
      env: process.env,
      globals: { ...globals, logger: undefined },
      ...additionalContext,
    });

    return result;
  }

  async endMessage(message: Message, traceId?: string) {
    return this.task.endMessage(message, traceId);
  }

  async handleMessage(message: Message, traceId?: string): Promise<Message> {
    message = await this.doHandleMessage(message, traceId);

    if (this.next) {
      return this.next.handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  async doHandleMessage(message: Message, _traceId?: string): Promise<Message> {
    return message;
  }
}
