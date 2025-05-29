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
    return this.registerSteps(this.config);
  }

  async importStep(step, task) {
    const [type, subType] = step.type.split(":");
    const Factory = (
      await import(normalize(`${srcDir}/${type}s/${subType}.js`))
    ).default;
    return new Factory(step, task);
  }

  async registerSteps(taskConfig) {
    let previousStep;

    for (const step of taskConfig.steps) {
      const currentStep = await this.importStep(step, taskConfig);

      currentStep.register();
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered step ${JSON.stringify(step)}.`
      );

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
