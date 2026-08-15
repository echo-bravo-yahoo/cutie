import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

export interface ReadConfig extends StepConfig {
  type: string;
  basePath?: string;
  virtual?: boolean;
}

export default abstract class Read extends Step {
  declare config: ReadConfig;
  abstract read(message: Message, traceId: string): Promise<Message>;

  constructor(config: ReadConfig, task: Task) {
    super(config, task);
  }

  async doHandleMessage(message: Message, traceId: string) {
    return this.read(message, traceId);
  }
}
