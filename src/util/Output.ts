import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";

export interface OutputConfig extends StepConfig {
  type: string;
  disabled: boolean;
}

export default abstract class Output extends Step {
  abstract send(message: any): Promise<string>;

  constructor(config: OutputConfig, task: Task) {
    super(config, task);
  }

  async doHandleMessage(message: any, _traceId?: string): Promise<string> {
    return this.send(message);
  }
}
