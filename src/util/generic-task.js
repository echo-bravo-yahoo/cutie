import { normalize } from "node:path";

import { globals, srcDir } from "../index.js";
import { Loggable } from "./generic-loggable.js";

export default class Task extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.steps = [];
  }

  async register() {
    await this.registerSteps(this.config);
    if (this.postRegister) await this.postRegister();
  }

  async importStep(step, task) {
    const [type, subType] = step.type.split(":");
    const Factory = (
      await import(normalize(`${srcDir}/${type}s/${subType}.js`))
    ).default;
    return new Factory(step, task);
  }

  async registerSteps(taskConfig) {
    const localLogger = globals.logger.child(
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
  async handleMessage(message) {
    return this.steps[0].handleMessage(message);
  }
}
