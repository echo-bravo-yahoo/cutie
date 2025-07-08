import { v7 as uuidV7 } from "uuid";

import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";

export interface InputConfig extends StepConfig {}

export default abstract class Input extends Step {
  constructor(config: InputConfig, task: Task) {
    super(config, task);
  }

  startMessage(message: any, traceId?: string) {
    if (traceId === undefined) traceId = uuidV7();

    if (this.next) {
      this.next.handleMessage(message, traceId);
    } else {
      this.endMessage(message, traceId);
    }
  }
}
