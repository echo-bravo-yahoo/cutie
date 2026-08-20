import Control, { ControlConfig } from "../util/Control.js";
import { HALT } from "../util/Step.js";
import Task from "../util/Task.js";
import { CompiledPredicate, compilePredicate } from "../util/javascript.js";
import { ModuleSchema } from "../util/schema.js";
import { Message } from "../util/type-helpers.js";

export interface StopConfig extends ControlConfig {
  when?: string;
}

// Ends the chain here, so the steps after it never run. The message is
// consumed rather than failed: dropping one used to mean throwing, which filed
// an error line for an ordinary condition.
export default class Stop extends Control {
  declare config: StopConfig;
  private when?: CompiledPredicate;

  constructor(config: StopConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    await super.register();
    if (this.config.when !== undefined)
      this.when = compilePredicate(this.config.when, "control:stop");
  }

  async doHandleMessage(message: Message, _traceId: string) {
    if (this.when && !this.when(message, this.config, this.task))
      return message;

    return HALT;
  }
}

export const schema: ModuleSchema = {
  type: "control:stop",
  description:
    "Ends the chain here, always or only when a predicate holds, so the steps after it never run. The message is consumed rather than failed.",
  options: {
    when: {
      type: "string",
      description:
        "The body of a JavaScript function deciding whether to stop the chain, read for truthiness. It receives message, stash, error, task, module, and env as arguments and must return its result, and it is compiled once when the task registers. Omit it to stop every time.",
    },
  },
};
