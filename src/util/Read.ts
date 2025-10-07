import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";
import { ConfigurableImplementation } from "./Configurable.js";

export interface ReadConfig extends StepConfig {
  type: string;
  basePath?: string;
  virtual?: boolean;
}

export default abstract class Read extends Step {
  declare config: ReadConfig;
  abstract read(message: Message, traceId: string): Promise<Message>;

  constructor(
    config: ReadConfig,
    task: Task,
    implementation: ConfigurableImplementation,
  ) {
    super(config, task, implementation);
  }

  async doHandleMessage(message: Message, traceId: string) {
    return this.read(message, traceId);
  }
}
