import { normalize } from "node:path";

import { globals, srcDir } from "../index.js";
import { Configurable, Config } from "./generic-configurable.js";
import Step, { StepConfig } from "./generic-step.js";

export interface TaskConfig extends Config {
  steps: Array<StepConfig>;
}

export default class Task extends Configurable {
  config: TaskConfig;
  steps: Array<Step>;
  // TODO: remove this hack
  postRegister?(): Promise<void>;

  constructor(config: TaskConfig, name: string) {
    super(config, name);

    this.config = config;
    this.steps = [];
  }

  async register() {
    await this.registerSteps(this.config);
    if (this.postRegister) await this.postRegister();
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
    const localLogger = globals.logger.child(
      {},
      {
        msgPrefix: "[core.registration.steps] ",
      }
    );

    let previousStep;

    for (const step of taskConfig.steps) {
      const currentStep = await this.importStep(step, taskConfig);
      currentStep.task = this;

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
  async handleMessage(message: any, traceId?: string) {
    return this.steps[0].handleMessage(message, traceId);
  }
}
