import Step from "./generic-step.js";
import Task from "./generic-task.js";

export interface OutputConfig {
  type: string;
  disabled: boolean;
}

export default abstract class Output extends Step {
  next?: Step;
  enabled: boolean;
  abstract send(message: any): Promise<void>;

  constructor(config: OutputConfig, task: Task) {
    super(config, task);
  }

  async handleMessage(message: any) {
    if (this.next) {
      await this.send(message);
      return this.next.handleMessage(message);
    } else {
      return this.send(message);
    }
  }
}
