import { Step } from "./generic-step.js";

export default class Output extends Step {
  constructor(config, task) {
    super(config, task);
  }

  async handleMessage(message) {
    if (this.next) {
      await this.send(message);
      return this.next.handleMessage(message);
    } else {
      return this.send(message);
    }
  }
}
