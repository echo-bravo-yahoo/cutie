import Sensor, { SensorConfig } from "../util/Sensor.js";
import Task from "../util/Task.js";
import { ModuleSchema } from "../util/schema.js";

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

  constructor(config: RandomConfig, task: Task, index?: number) {
    super(config, task, index);
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

export const schema: ModuleSchema = {
  type: "trigger:random",
  description:
    "Samples a drifting number on one interval and reports an aggregate on another. Deprecated: prefer trigger:cron into read:random into transform:aggregate, which separates when to sample from what to read and how to collapse the samples.",
  options: {
    min: {
      type: "number",
      description: "The lowest value a sample may take.",
      required: true,
    },
    max: {
      type: "number",
      description: "The highest value a sample may take.",
      required: true,
    },
    minStep: {
      type: "number",
      description: "The smallest change between consecutive samples.",
      required: true,
    },
    maxStep: {
      type: "number",
      description: "The largest change between consecutive samples.",
      required: true,
    },
    start: {
      type: "number",
      description: "The value the first sample drifts away from.",
      required: true,
    },
    samplingInterval: {
      type: "number",
      description: "How long to wait between samples.",
      default: 60 * 1000,
      unit: "ms",
    },
    reportingInterval: {
      type: "number",
      description: "How long to wait between reported messages.",
      default: 60 * 1000,
      unit: "ms",
    },
    sampling: {
      type: "object",
      description:
        'How to collapse the samples taken since the last report, as {"aggregation": "average"}. Required in practice whenever sampling outpaces reporting.',
    },
  },
};
