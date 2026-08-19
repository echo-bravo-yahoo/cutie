import { normalize } from "node:path";

import { srcDir } from "../index.js";
import { Configurable, Config } from "./Configurable.js";
import { logAt } from "./LogHelper.js";
import { registerSchema } from "./schema.js";
import Step, { StepConfig, runWithMessageContext } from "./Step.js";
import { newTraceId } from "./trace.js";
import { isStep, Message } from "./type-helpers.js";
import Trigger, { TriggerConfig } from "./Trigger.js";

export interface TaskConfig extends Config {
  trigger?: TriggerConfig;
  steps?: Array<StepConfig>;
  // Arbitrary task-scoped values, reachable from any step's interpolation
  // context as ${task.config.data...}.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
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

    if (this.trigger?.shouldEnable()) await this.trigger.enable();

    for (const step of this.steps) {
      await step.enable();
    }
  }

  // primarily used for testing to cause trigger-less tasks to still emit events
  async startMessage(message: Message, traceId: string = newTraceId()) {
    const startedAt = performance.now();

    // The stash belongs to this message, not to the task, so two messages in
    // flight never read each other's values.
    const result = await runWithMessageContext(
      { stash: {}, message, traceId },
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

    return result;
  }

  // TODO: implement some callback behavior here
  async endMessage(message: Message, _traceId: string) {
    this.messagesHandled++;
    return message;
  }
}
