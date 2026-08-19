import TaskModule, { TaskModuleConfig } from "./TaskModule.js";
import { Message } from "./type-helpers.js";

export interface TriggerConfig extends TaskModuleConfig {}

// A trigger starts a message rather than handling one, so it has no place in
// the chain: Task.registerSteps rejects one in a step slot, as does the
// validator.
export default abstract class Trigger extends TaskModule {
  startMessage(message: Message, traceId?: string) {
    this.task.startMessage(message, traceId);
  }
}
