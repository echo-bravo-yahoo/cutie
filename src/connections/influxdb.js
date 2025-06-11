import { Connection } from "../util/generic-connection.js";

export default class InfluxDB extends Connection {
  constructor(config, task) {
    super(config, task);
  }

  async register() {
    if (!this.config.disabled) {
      return this.enable();
    }
  }

  async enable() {}
}
