import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

export interface OutputConfig extends StepConfig {
  type: string;
  disabled: boolean;
}

export default abstract class Output extends Step {
  abstract send(message: Message): Promise<string>;

  constructor(config: OutputConfig, task: Task) {
    super(config, task);
  }

  async doHandleMessage(message: Message, _traceId?: string): Promise<string> {
    return this.send(message);
  }
}
