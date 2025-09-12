import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface RandomConfig extends ReadConfig {
  minStep: number;
  maxStep: number;
  max: number;
  min: number;
  start: number;
}

export default class Random extends Read {
  declare config: RandomConfig;
  lastNumber: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare samples: Array<any>;

  constructor(config: RandomConfig, task: Task) {
    super(config, task, {});
    this.lastNumber = config.start || 0;

    this.name = "random";
  }

  generateNextNumber() {
    const min = this.config.minStep;
    const max = this.config.maxStep;
    const step = Math.random() * (max - min) + min;
    const parity = Math.random() > 0.5 ? +1 : -1;
    let result = this.lastNumber;
    if (this.lastNumber + parity * step >= this.config.max) {
      result = this.lastNumber - parity * step;
    } else if (this.lastNumber + parity * step <= this.config.min) {
      result = this.lastNumber - parity * step;
    } else {
      result = this.lastNumber + parity * step;
    }

    this.lastNumber = result;
    return result;
  }

  async read(_message: Message, _traceId: string) {
    return this.generateNextNumber();
  }

  async enable() {
    this.info("Enabled random number module.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled random number module.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "read:random",
  "disabled": false,
  "start": 22,
  "minStep": .05,
  "maxStep": .5,
  "max": 30,
  "min": 20,
}
*/
