import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

export interface OutputConfig extends StepConfig {
  type: string;
  disabled: boolean;
}

export default abstract class Output extends Step {
  abstract send(message: Message, traceId: string): Promise<Message>;

  constructor(config: OutputConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // An output is a side effect, not a transform, so the message a later step
  // sees is the one this step was handed. Enforced here rather than in each
  // send(), which makes an output module's return value dead.
  async doHandleMessage(message: Message, traceId: string): Promise<Message> {
    await this.send(message, traceId);

    return message;
  }
}
