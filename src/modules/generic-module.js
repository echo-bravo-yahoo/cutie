import { Stateful } from "./generic-stateful.js";

export class Module extends Stateful {
  constructor(stateKey) {
    super(stateKey);

    this.paths = {};
  }

  // TODO: mostly a carbon-copy of generic-config.handleStateChange
  async handleStateChange(newState, _reported) {
    this.updateState(newState);
  }

  // takes in the entire state tree and decomposes it to the ones relevant to this module
  async handleState({ desired, delta, reported }) {
    this.genericHandleState({
      desired,
      delta,
      reported,
      shortPath: this.stateKey,
      path: `modules[${this.stateKey}]`,
      type: "module",
    });
  }

  async handleEnabled(newState) {
    if (!this.currentState.enabled && newState.enabled)
      return this.enable(newState);
    if (this.currentState.enabled && !newState.enabled)
      return this.disable(newState);
  }

  async init(newState) {
    return this.updateState(newState);
  }
}
