import TaskModule, {
  TaskModuleConfig,
  currentMessageContext,
  runWithMessageContext,
} from "./TaskModule.js";
import { Message } from "./type-helpers.js";

// Re-exported rather than moved so that every module importing one of these
// from "./Step.js" keeps working; they are defined on TaskModule because a
// trigger needs them without being in the chain.
export {
  CODE_OUTPUT_TYPES,
  NO_MESSAGE,
  cloneMessage,
  configDir,
  currentMessageContext,
  requireOneCodeSource,
  resolveConfigPath,
  runWithMessageContext,
} from "./TaskModule.js";
export type { CodeConfig, MessageContext } from "./TaskModule.js";

export interface StepConfig extends TaskModuleConfig {}

// Returned by a step that swallows a message rather than passing it on, so the
// chain stops without leaving the caller's promise unsettled.
export const HALT = Symbol("halt");

// A TaskModule that sits in the task's chain. A trigger starts a message and so
// is not one.
export default abstract class Step extends TaskModule {
  declare config: StepConfig;
  next?: Step;

  async endMessage(message: Message, traceId: string) {
    return this.task.endMessage(message, traceId);
  }

  async handleMessage(message: Message, traceId: string): Promise<Message> {
    // Task.startMessage normally opens the store; entering the chain at a step
    // directly opens one here, so a step always has a stash to write to.
    if (!currentMessageContext())
      return runWithMessageContext({ stash: {}, message, traceId }, () =>
        this.handleMessage(message, traceId),
      );

    // Keeps ${message} pointing at what this step was handed, for every step.
    const context = currentMessageContext();
    if (context) context.message = message;

    const startedAt = performance.now();
    const handled = await this.doHandleMessage(message, traceId);
    this.debug(
      `Handled message in ${(performance.now() - startedAt).toFixed(1)}ms.`,
      { traceId },
      { type: this.config.type },
    );

    // transform:accumulate halts every message that does not complete a batch
    if (handled === HALT) return undefined;
    message = handled;

    if (context) context.message = message;

    if (this.next) {
      return this.next.handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    return message;
  }
}
