import { Step } from "./generic-step.js";

export default class Output extends Step {
  constructor(config, task) {
    super(config, task);
  }

  async handleMessage(message) {
    return this.send(message);
  }
}
