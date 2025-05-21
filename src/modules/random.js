import { globals } from "../index.js";
import { Sensor } from "../util/generic-sensor.js";

export default class Random extends Sensor {
  constructor(config) {
    super(config);

    this.lastNumber = config.start || 0;
  }

  async register() {
    if (this.config.enabled) {
      this.enable();
    }
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

  collateSamples() {
    return {
      metadata: {
        island: globals.name,
      },
      number: this.samples,
    };
  }

  async sample() {
    if (!this.config.enabled) return;

    const datapoint = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      number: this.generateNextNumber(),
    };

    this.debug({}, `Sampled new data point`);
    this.samples.push(datapoint);
    this.lastNumber = datapoint.number;
  }

  async enable() {
    this.info({}, `Enabled random number module.`);
    this.setupPublisher();
    this.setupSampler();
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);
    this.info({}, `Disabled random number module.`);
    this.enabled = false;
  }
}

/*
{
  "name": "fake-thermometer",
  "type": "random",
  "enabled": true,
  "start": 22,
  "minStep": .05,
  "maxStep": .5,
  "max": 30,
  "min": 20,
  "sampling": {
    "interval": 10000,
  },
  "reporting": {
    "interval": 10000
  }
}
*/
