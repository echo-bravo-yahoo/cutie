import TaskModule, { TaskModuleConfig } from "./TaskModule.js";
import { newTraceId } from "./trace.js";
import { Message } from "./type-helpers.js";

export interface TriggerConfig extends TaskModuleConfig {}

// A trigger starts a message rather than handling one, so it has no place in
// the chain: Task.registerSteps rejects one in a step slot, as does the
// validator.
export default abstract class Trigger extends TaskModule {
  // Where a failed message stops. One panel refresh that rejects must not take
  // the node down and every unrelated task with it, and a trigger is the only
  // path a production message takes, so containing here covers all of them.
  //
  // `produce` runs inside the guard rather than being handed a message,
  // because a trigger that interpolates inside its own timer callback throws
  // synchronously, where guarding the promise alone would not reach it.
  fire(produce: () => Message, incomingTraceId?: string) {
    const traceId = incomingTraceId ?? newTraceId();

    let message;
    try {
      message = produce();
    } catch (error) {
      this.abandon(error, traceId);
      return;
    }

    return this.startMessage(message, traceId);
  }

  // The public entry, for the two triggers a caller drives directly: the MQTT
  // connection dispatching a received message, and LogHelper fanning a line
  // out to its listeners.
  startMessage(message: Message, incomingTraceId?: string) {
    const traceId = incomingTraceId ?? newTraceId();

    return this.task
      .startMessage(message, traceId)
      .catch((error: unknown) => this.abandon(error, traceId));
  }

  // The step that threw has already logged under its own topic; this says what
  // became of the message, which is the part only the trigger knows.
  private abandon(error: unknown, traceId: string) {
    this.error(
      `Abandoned message: ${this.errorContext(error).message}`,
      { traceId },
      { task: this.task.name },
    );
  }
}
