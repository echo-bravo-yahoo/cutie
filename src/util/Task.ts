import { normalize } from "node:path";

import set from "lodash/set.js";

import { srcDir } from "../index.js";
import { Configurable, Config } from "./Configurable.js";
import { logAt } from "./LogHelper.js";
import { registerSchema } from "./schema.js";
import Step, { StepConfig, isReturned, runWithMessageContext } from "./Step.js";
import type { ErrorContext, MessageContext } from "./TaskModule.js";
import { newTraceId } from "./trace.js";
import { isStep, Message } from "./type-helpers.js";
import Trigger, { TriggerConfig } from "./Trigger.js";

export interface TaskConfig extends Config {
  trigger?: TriggerConfig;
  steps?: Array<StepConfig>;
  // Which task to run when a step of this one fails, unless that step names a
  // rescue of its own.
  rescue?: string;
  // Arbitrary task-scoped values, reachable from any step's interpolation
  // context as ${task.config.data...}.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
}

// What a task hands back to whatever invoked it. `returned` is the part only
// an invoking step needs: a rescue that returned has a message to substitute,
// and one that fell off the end has none.
export interface Invocation {
  returned: boolean;
  value: Message;
}

// What a step invoking another task hands down with the message.
export interface Caller {
  // Set only when the invocation is a rescue, and what ${error...} resolves
  // against inside the callee.
  error?: ErrorContext;
  // The stash the caller is holding. The callee works on a deep copy of it,
  // and only the keys control:return names are written back.
  stash?: MessageContext["stash"];
}

export default class Task extends Configurable {
  declare config: TaskConfig;
  declare trigger?: Trigger;
  steps: Array<Step>;
  messagesHandled: number;

  constructor(config: TaskConfig, name: string) {
    super(config, name);

    this.steps = [];

    this.logPrefix = `core.runtime.tasks.${name}`;
    this.messagesHandled = 0;
  }

  async register() {
    await this.registerSteps(this.config);
    this.enabled = true;
  }

  async importStep(step: StepConfig, index?: number) {
    const [type, subType] = step.type.split(":");
    const module = await import(normalize(`${srcDir}/${type}s/${subType}.js`));

    // Configurable's constructor reads schema defaults out of a synchronous
    // cache, so the schema has to land there before the instance is built.
    if (module.schema) registerSchema(module.schema);

    return new module.default(step, this, index);
  }

  async registerSteps(taskConfig: TaskConfig) {
    const topic = "core.registration.steps";
    let previousStep;

    if (taskConfig.trigger) {
      this.trigger = (await this.importStep(
        taskConfig.trigger,
      )) as unknown as Trigger;
      this.trigger.task = this;
      await this.trigger.register();
      logAt(topic, "info", "Registered trigger.", taskConfig.trigger);
    }

    for (const [index, step] of (taskConfig.steps ?? []).entries()) {
      const currentStep = await this.importStep(step, index);
      if (!isStep(currentStep))
        throw new Error(`Triggers cannot be specified as a step.`);
      currentStep.task = this;

      await currentStep.register();
      logAt(topic, "info", "Registered step.", step);

      // A disabled step is left out of the chain rather than linked and skipped,
      // so its doHandleMessage never runs. `index` above stays the position in
      // taskConfig.steps either way, so log topics match the config as written.
      if (!currentStep.shouldEnable()) continue;

      this.steps.push(currentStep);
      if (previousStep) {
        previousStep.next = currentStep;
      }

      previousStep = currentStep;
    }

    // Steps are enabled before the trigger, not after: the trigger is what starts
    // messages flowing, and it can begin firing the instant its own enable()
    // returns - trigger:once fires on the next tick, an MQTT subscribe can
    // deliver a retained message right away, a GPIO watch can fire on a pin
    // that's already asserted, and trigger:repeat fires as soon as its interval
    // elapses, which can be shorter than a slow step's enable(). If the trigger
    // went first, any one of those could reach a step whose own enable() is
    // still mid-flight - hardware init in particular can take the better part
    // of a second - and land on a message silently dropped by that step's own
    // `!this.enabled` guard. Enabling the chain first means every step is
    // fully ready before anything can start a message, and a step that throws
    // on enable cannot leave a live trigger over a half-enabled chain.
    for (const step of this.steps) {
      await step.enable();
    }

    if (this.trigger?.shouldEnable()) await this.trigger.enable();
  }

  // The one path a message takes through a task's chain. A step invokes
  // another task through here when it fails and its config names a rescue;
  // startMessage is the same call with the discriminant dropped.
  async invoke(
    message: Message,
    traceId: string = newTraceId(),
    caller: Caller = {},
  ): Promise<Invocation> {
    const startedAt = performance.now();

    // The stash belongs to this message, not to the task, so two messages in
    // flight never read each other's values. A deep copy of the caller's, not
    // the caller's own object: output:stash writes with lodash `set`, so a
    // callee writing a dotted key would otherwise rewrite a nested object its
    // caller is still holding.
    const stash = caller.stash ? structuredClone(caller.stash) : {};

    const outcome = await runWithMessageContext(
      { stash, message, traceId, error: caller.error },
      async () =>
        this.steps[0]
          ? this.steps[0].handleMessage(message, traceId)
          : this.endMessage(message, traceId),
    );

    this.debug(
      `Handled message in ${(performance.now() - startedAt).toFixed(1)}ms.`,
      { traceId },
      { steps: this.steps.length },
    );

    // Falling off the end returns nothing, so a task that only reports cannot
    // leak its own bookkeeping into whatever invoked it.
    if (!isReturned(outcome)) return { returned: false, value: outcome };

    // `set`, not a plain assignment, so a dotted key writes the nested path
    // read:stash's `get` would read back, exactly as output:stash does.
    //
    // Written by reference into the caller's live stash, which is sound only
    // because Step.recover -- the one caller today -- is synchronously nested
    // inside the message being rescued and finishes before it carries on. A
    // hand-off that does not await its callee must not publish back this way:
    // see .claude/docs/design-principles.md, "Message context across a
    // hand-off".
    if (caller.stash && outcome.stash)
      for (const [key, value] of Object.entries(outcome.stash))
        set(caller.stash, key, value);

    // Through endMessage, so a message that ended at a control:return counts
    // as handled just like one that ran to the end of the chain.
    return {
      returned: true,
      value: await this.endMessage(outcome.value, traceId),
    };
  }

  // primarily used for testing to cause trigger-less tasks to still emit events
  async startMessage(message: Message, traceId: string = newTraceId()) {
    return (await this.invoke(message, traceId)).value;
  }

  // TODO: implement some callback behavior here
  async endMessage(message: Message, _traceId: string) {
    this.messagesHandled++;
    return message;
  }
}
