import { Module } from "../util/generic-module.js";

export default class Interval extends Module {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.config.enabled) {
      this.enable();
    }
  }

  async enable() {
    this.interval = setInterval(
      this.runAllTransformations.bind(this, this.config.message),
      config.interval
    );
    this.info({}, `Enabled interval.`);
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.interval);
    this.info({}, `Disabled interval.`);
    this.enabled = false;
  }
}

/*
{
  "type": "interval",
  "enabled": true,
  "message": { ... },
  "interval": 10000 // in ms
}
*/
