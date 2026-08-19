import Control, { ControlConfig } from "../util/Control.js";
import { Returned } from "../util/Step.js";
import Task from "../util/Task.js";
import { ModuleSchema } from "../util/schema.js";
import { Message } from "../util/type-helpers.js";

export interface ReturnConfig extends ControlConfig {
  value?: Message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stash?: Record<string, any>;
}

// Ends the chain and hands a value back to whatever invoked the task. A task
// that falls off its own end instead returns nothing, so nothing crosses back
// unless a step says so.
export default class Return extends Control {
  declare config: ReturnConfig;

  constructor(config: ReturnConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async doHandleMessage(message: Message, _traceId: string) {
    // interpolateDeep, not interpolateConfigString: a value that is exactly
    // one template keeps the resolved value's type, so a number comes back a
    // number rather than its stringification.
    return new Returned(
      this.config.value === undefined
        ? message
        : this.interpolateDeep(this.config.value, { message }),
      this.config.stash === undefined
        ? undefined
        : (this.interpolateDeep(this.config.stash, { message }) as Record<
            string,
            unknown
          >),
    );
  }
}

export const schema: ModuleSchema = {
  type: "control:return",
  description:
    "Ends the chain and hands a value back to whatever invoked this task, such as the step that named it as its rescue.",
  options: {
    value: {
      type: "any",
      description: "What to hand back. Defaults to the message as it stands.",
      interpolated: true,
    },
    stash: {
      type: "object",
      description:
        "Values to write into the caller's stash, keyed as output:stash keys are, so a dotted key writes a nested path.",
      interpolated: true,
    },
  },
};
