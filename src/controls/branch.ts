import Control, { ControlConfig } from "../util/Control.js";
import { currentMessageContext } from "../util/Step.js";
import Task from "../util/Task.js";
import { findRegisteredTask } from "../util/globals.js";
import { CompiledPredicate, compilePredicate } from "../util/javascript.js";
import { ModuleSchema } from "../util/schema.js";
import { Message } from "../util/type-helpers.js";

export interface BranchConfig extends ControlConfig {
  task: string;
  when?: string;
}

// Runs another task from inside this one and then carries on. The predicate is
// here rather than in the target, so the condition sits at the callsite it
// controls and the target stays an ordinary task that does not know it is one.
export default class Branch extends Control {
  declare config: BranchConfig;
  private when?: CompiledPredicate;

  constructor(config: BranchConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    await super.register();
    if (this.config.when !== undefined)
      this.when = compilePredicate(this.config.when, "control:branch");
  }

  async doHandleMessage(message: Message, traceId: string) {
    if (this.when && !this.when(message, this.config, this.task))
      return message;

    // Resolved per message rather than at enable(): a task may branch to one
    // declared after it, which has not registered when this one enables.
    const target = findRegisteredTask(this.config.task);
    if (!target)
      throw new Error(
        `Cannot branch: no registered task named "${this.config.task}".`,
      );

    const context = currentMessageContext();
    const outcome = await target.invoke(message, traceId, {
      error: context?.error,
      stash: context?.stash,
    });

    // The target decides, exactly as a rescue's does: one that ends at a
    // control:return replaces the message, and one that falls off its own end
    // leaves the message this step was handed to carry on.
    return outcome.returned ? outcome.value : message;
  }
}

export const schema: ModuleSchema = {
  type: "control:branch",
  description:
    "Runs another task from inside this one, always or only when a predicate holds, then carries on with the rest of this task's steps.",
  options: {
    task: {
      type: "string",
      description:
        "Which task to run. An ordinary task declared under tasks:, which does not need to know it is a branch target.",
      required: true,
    },
    when: {
      type: "string",
      description:
        "The body of a JavaScript function deciding whether to run the task, read for truthiness. It receives message, stash, error, task, module, and env as arguments and must return its result, and it is compiled once when the task registers. Omit it to run the task every time.",
    },
  },
};
