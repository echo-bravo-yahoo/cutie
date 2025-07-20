import { normalize } from "node:path";

import { globals, srcDir } from "../index.js";
import { Configurable, Config } from "./Configurable.js";
import Step, { StepConfig } from "./Step.js";
import { Message } from "./type-helpers.js";

export interface TaskConfig extends Config {
  steps: Array<StepConfig>;
}

export default class Task extends Configurable {
  declare config: TaskConfig;
  steps: Array<Step>;

  constructor(config: TaskConfig, name: string) {
    super(config, name);

    // TO-DO: why in the WORLD is this necessary?
    // TypedConfigurable already sets this but for some reason,
    // it's dropped by the time we get to here in tests
    this.config = config;
    this.steps = [];
  }

  async register() {
    await this.registerSteps(this.config);
    this.enabled = true;
  }

  async importStep(step: StepConfig, task: TaskConfig) {
    const [type, subType] = step.type.split(":");
    const Factory = (
      await import(normalize(`${srcDir}/${type}s/${subType}.js`))
    ).default;

    return new Factory(step, task);
  }

  async registerSteps(taskConfig: TaskConfig) {
    const topic = "core.registration.steps";
    let previousStep;

    for (const step of taskConfig.steps) {
      const currentStep = await this.importStep(step, taskConfig);
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

    for (const step of this.steps) {
      if (step.shouldEnable()) await step.enable();
    }
  }

  // primarily used for testing to cause input-less tasks to still emit events
  async handleMessage(message: Message, traceId?: string) {
    return this.steps[0].handleMessage(message, traceId);
  }
}
