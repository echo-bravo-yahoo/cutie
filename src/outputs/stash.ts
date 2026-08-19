import set from "lodash/set.js";

import Output, { OutputConfig } from "../util/Output.js";
import { currentMessageContext } from "../util/Step.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface StashConfig extends OutputConfig {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export default class Stash extends Output {
  declare config: StashConfig;

  constructor(config: StashConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async send(message: Message, traceId: string) {
    this.info(
      `Stashing value under key "${this.config.key}".`,
      { traceId },
      {
        event: message,
      },
    );

    // Step.handleMessage opens the store before any step runs, so this is only
    // ever undefined when send() is called outside a message chain.
    const context = currentMessageContext();

    if (!context)
      throw new Error(
        `"output:stash" can only run inside a message chain; nothing started this one.`,
      );

    // interpolateDeep, not interpolateConfigString: a value that is exactly one
    // template is stashed with its type, so read:stash hands back the number
    // the message carried rather than its stringification.
    const value = this.interpolateDeep(this.config.value, { message });

    // `set`, not a plain assignment, so a dotted key writes the nested path
    // read:stash's `get` would read back.
    set(
      context.stash,
      this.interpolateConfigString(this.config.key, { message }),
      value,
    );

    return message;
  }
}

export const schema: ModuleSchema = {
  type: "output:stash",
  description:
    "Stores a value in the stash, a scratch space belonging to one message.",
  options: {
    key: {
      type: "string",
      description:
        "Where to store the value; a dotted key writes a nested path.",
      required: true,
      interpolated: true,
    },
    value: {
      type: "any",
      description:
        "The value to store. A string is interpolated first; one that is exactly one template keeps the resolved value's type.",
      required: true,
      interpolated: true,
    },
  },
};
