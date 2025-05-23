import { Loggable } from "./generic-loggable.js";

export class Connection extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.stateKey = config.name || config.type;
  }
}
