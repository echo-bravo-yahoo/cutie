import Sensor, { SensorConfig } from "../util/Sensor.js";
import Task from "../util/Task.js";

export interface RandomConfig extends SensorConfig {
  minStep: number;
  maxStep: number;
  max: number;
  min: number;
  start: number;
}

export default class Random extends Sensor {
  declare config: RandomConfig;
  lastNumber: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare samples: Array<any>;

  constructor(config: RandomConfig, task: Task) {
    super(config, task);
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

  collateSamples() {
    return this.samples;
  }

  async sample() {
    if (this.config.disabled) return;

    const datapoint = this.generateNextNumber();

    this.debug(
      "Sampled new data point.",
      { topic: this.logPrefix },
      { datapoint },
    );
    this.samples.push(datapoint);
    this.lastNumber = datapoint;
  }

  async enable() {
    this.info("Enabled random number module.", { topic: this.logPrefix });
    this.setupPublisher();
    this.setupSampler();
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);
    this.info("Disabled random number module.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "name": "fake-thermometer",
  "type": "random",
  "disabled": false,
  "start": 22,
  "minStep": .05,
  "maxStep": .5,
  "max": 30,
  "min": 20,
  "samplingInterval": 10000,
  "reportingInterval": 10000
  }
}
*/
