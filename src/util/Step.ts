import get from "lodash/get.js";

import { globals } from "../index.js";
import Task from "./Task.js";
import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";
import { Message } from "./type-helpers.js";

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
    // TODO: why in the WORLD is this necessary?
    // TypedConfigurable already sets this but for some reason,
    // it's dropped by the time we get to here in tests
    this.config = config;
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
      task: this.task,
      module: this.config,
      globals: { ...globals, logger: undefined },
      ...additionalContext,
    });

    return result;
  }

  // TODO: implement some callback behavior here
  async endMessage(message: Message, _traceId?: string) {
    return message;
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
