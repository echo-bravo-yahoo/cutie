import Step from "./generic-step.js";
import Task from "./generic-task.js";
import { TypedConfig } from "./generic-typed-configurable.js";

export interface InputConfig extends TypedConfig {}

export default abstract class Input extends Step {
  constructor(config: InputConfig, task: Task) {
    super(config, task);
  }

  startMessage(message: any, traceId: string) {
    if (this.next) {
      this.next.handleMessage(message, traceId);
    } else {
      this.endMessage(message, traceId);
    }
  }
}
