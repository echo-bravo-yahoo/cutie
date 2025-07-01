import { normalize } from "node:path";

import { globals, srcDir } from "../index.js";
import { Globals, Loggable } from "./generic-loggable.js";
import Step, { StepConfig } from "./generic-step.js";

export interface TaskConfig {
  steps: Array<StepConfig>;
}

export default class Task extends Loggable {
  config: TaskConfig;
  steps: Array<Step>;
  postRegister?(): Promise<void>;
  disabled?: boolean;

  constructor(config: TaskConfig) {
    super();

    this.config = config;
    this.steps = [];
  }

  async register() {
    await this.registerSteps(this.config);
    if (this.postRegister) await this.postRegister();
  }

  async importStep(step: StepConfig, task: TaskConfig) {
    const [type, subType] = step.type.split(":");
    const Factory = (
      await import(normalize(`${srcDir}/${type}s/${subType}.js`))
    ).default;
    return new Factory(step, task);
  }

  async registerSteps(taskConfig: TaskConfig) {
    const localLogger = (globals as Globals).logger.child(
      {},
      {
        msgPrefix: "[core.registration.steps] ",
      }
    );

    let previousStep;

    for (const step of taskConfig.steps) {
      const currentStep = await this.importStep(step, taskConfig);
      currentStep.liveTask = this;

      currentStep.register();
      localLogger.info({ context: step }, "Registered step.");

      this.steps.push(currentStep);
      if (previousStep) {
        previousStep.next = currentStep;
      }

      previousStep = currentStep;
    }
  }

  // primarily used for testing to cause input-less tasks to still emit events
  async handleMessage(message: any) {
    return this.steps[0].handleMessage(message);
  }
}
