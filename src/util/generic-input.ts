import Step from "./generic-step.js";
import Task from "./generic-task.js";

export interface InputConfig {
  type: string;
}

export default abstract class Input extends Step {
  constructor(config: InputConfig, task: Task) {
    super(config, task);
  }
}
