import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

export interface TriggerConfig extends StepConfig {}

export default abstract class Trigger extends Step {
  constructor(config: TriggerConfig, task: Task) {
    super(config, task);
  }

  startMessage(message: Message, traceId?: string) {
    this.task.startMessage(message, traceId);
  }
}
