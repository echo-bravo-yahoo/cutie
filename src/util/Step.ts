import { globals } from "./globals.js";
import TaskModule, {
  TaskModuleConfig,
  currentMessageContext,
  runWithMessageContext,
} from "./TaskModule.js";
import type Task from "./Task.js";
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
export type { CodeConfig, ErrorContext, MessageContext } from "./TaskModule.js";

export interface StepConfig extends TaskModuleConfig {
  // Which task to run when this step fails, defaulting to the one its own task
  // names. Universal, like `disabled`; declared in UNIVERSAL_OPTION_SCHEMAS.
  rescue?: string;
}

// Returned by a step that swallows a message rather than passing it on, so the
// chain stops without leaving the caller's promise unsettled.
export const HALT = Symbol("halt");

// What control:return hands back to whatever invoked the task. A value rather
// than a bare symbol, because the message being returned travels with it. Only
// Task.invoke unwraps one; every step between there and here passes it up
// untouched.
export class Returned {
  constructor(
    public value: Message,
    // Written into the caller's stash by Task.invoke. Nothing else crosses
    // back, so a callee's own bookkeeping stays its own.
    public stash?: Record<string, unknown>,
  ) {}
}

export function isReturned(value: unknown): value is Returned {
  return value instanceof Returned;
}

// A TaskModule that sits in the task's chain. A trigger starts a message and so
// is not one.
export default abstract class Step extends TaskModule {
  declare config: StepConfig;
  next?: Step;

  async endMessage(message: Message, traceId: string) {
    return this.task.endMessage(message, traceId);
  }

  async handleMessage(message: Message, traceId: string): Promise<Message> {
    // Task.invoke normally opens the store; entering the chain at a step
    // directly opens one here, so a step always has a stash to write to.
    if (!currentMessageContext())
      return runWithMessageContext({ stash: {}, message, traceId }, () =>
        this.handleMessage(message, traceId),
      );

    // Keeps ${message} pointing at what this step was handed, for every step.
    const context = currentMessageContext();
    if (context) context.message = message;

    const startedAt = performance.now();
    let handled;

    try {
      handled = await this.doHandleMessage(message, traceId);
    } catch (error) {
      return this.recover(error, message, traceId);
    }

    this.debug(
      `Handled message in ${(performance.now() - startedAt).toFixed(1)}ms.`,
      { traceId },
      { type: this.config.type },
    );

    // transform:accumulate halts every message that does not complete a batch
    if (handled === HALT) return undefined;
    // control:return ends the chain here, whatever is left of it
    if (isReturned(handled)) return handled;

    return this.passOn(handled, traceId);
  }

  private passOn(message: Message, traceId: string) {
    const context = currentMessageContext();
    if (context) context.message = message;

    if (this.next) {
      return this.next.handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  // Logged here, where the topic names the step that failed and the trace is
  // still in hand. What happens next is the config's to say: with a `rescue`
  // the named task decides, and without one the failure is the caller's to see
  // -- a trigger contains it, and a programmatic caller is told.
  private async recover(
    error: unknown,
    message: Message,
    traceId: string,
  ): Promise<Message> {
    const failure = this.errorContext(error);

    this.error(
      `Failed to handle message: ${failure.message}`,
      { traceId },
      {
        task: failure.task,
        step: failure.step,
        type: failure.type,
        error: { message: failure.message, name: failure.name },
      },
    );

    const rescue = this.rescueTask();
    if (!rescue) throw error;

    let outcome;
    try {
      outcome = await rescue.invoke(message, traceId, {
        error: failure,
        stash: currentMessageContext()?.stash,
      });
    } catch (rescueError) {
      // The rescue's own failing step logged under its own topic on the way
      // out. Ending the message here rather than rethrowing keeps a broken
      // rescue from reading like the step that called it.
      this.error(
        `Rescue task "${rescue.name}" failed: ${this.errorContext(rescueError).message}`,
        { traceId },
      );

      return undefined;
    }

    // This step failed, so it produced nothing to carry on with: a rescue that
    // only reports the failure ends the message here.
    if (!outcome.returned) return undefined;

    return this.passOn(outcome.value, traceId);
  }

  private rescueTask(): Task | undefined {
    const name = this.config.rescue ?? this.task.config.rescue;
    if (name === undefined) return undefined;

    // Registered, not merely declared: the validator rejects a rescue naming a
    // task the config does not have, so what is left is a task that failed to
    // register, and a half-registered chain is not one to hand a message to.
    const rescue = globals.tasks.find(
      (task) => task.name === name && task.enabled,
    );

    if (!rescue)
      this.error(`Cannot rescue: no registered task named "${name}".`);

    return rescue;
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    return message;
  }
}
