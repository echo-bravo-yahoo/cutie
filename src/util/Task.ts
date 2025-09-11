import { normalize } from "node:path";

import { v7 as uuidV7 } from "uuid";

import { globals, srcDir } from "../index.js";
import { Configurable, Config } from "./Configurable.js";
import Step, { StepConfig } from "./Step.js";
import { isTrigger, Message } from "./type-helpers.js";
import Trigger, { TriggerConfig } from "./Trigger.js";

export interface TaskConfig extends Config {
  trigger?: TriggerConfig;
  steps: Array<StepConfig>;
}

export default class Task extends Configurable {
  declare config: TaskConfig;
  declare trigger?: Trigger;
  steps: Array<Step>;

  constructor(config: TaskConfig, name: string) {
    super(config, name);

    // TODO: why in the WORLD is this necessary?
    // TypedConfigurable already sets this but for some reason,
    // it's dropped by the time we get to here in tests
    this.config = config;
    this.steps = [];

    this.logPrefix = `core.runtime.tasks.${name}`;
  }

  async register() {
    await this.registerSteps(this.config);
    this.enabled = true;
  }

  async importStep(step: StepConfig) {
    const [type, subType] = step.type.split(":");
    const Factory = (
      await import(normalize(`${srcDir}/${type}s/${subType}.js`))
    ).default;

    return new Factory(step, this);
  }

  async registerSteps(taskConfig: TaskConfig) {
    const topic = "core.registration.steps";
    let previousStep;

    if (taskConfig.trigger) {
      this.trigger = (await this.importStep(
        taskConfig.trigger,
      )) as unknown as Trigger;
      this.trigger.task = this;
      this.trigger.register();
      globals.logger.emit(
        Configurable.formatLogLine("Registered trigger.", { topic }),
        "info",
        topic,
        taskConfig.trigger,
      );
    }

    for (const step of taskConfig.steps) {
      const currentStep = await this.importStep(step);
      if (isTrigger(currentStep))
        throw new Error(`Triggers cannot be specified as a step.`);
      currentStep.task = this;

      await currentStep.register();
      globals.logger.emit(
        Configurable.formatLogLine("Registered step.", { topic }),
        "info",
        topic,
        step,
      );

      this.steps.push(currentStep);
      if (previousStep) {
        previousStep.next = currentStep;
      }

      previousStep = currentStep;
    }

    if (this.trigger?.shouldEnable()) await this.trigger.enable();

    for (const step of this.steps) {
      if (step.shouldEnable()) await step.enable();
    }
  }

  // primarily used for testing to cause trigger-less tasks to still emit events
  async startMessage(message: Message, traceId?: string) {
    if (traceId === undefined) traceId = uuidV7();
    if (this.steps[0]) {
      return this.steps[0].handleMessage(message, traceId);
    } else {
      return this.endMessage(message, traceId);
    }
  }

  // TODO: implement some callback behavior here
  async endMessage(message: Message, _traceId?: string) {
    return message;
  }
}
