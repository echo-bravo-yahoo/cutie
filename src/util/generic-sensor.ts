import get from "lodash/get.js";
import map from "lodash/map.js";

import Input from "./generic-input.js";
import Task from "./generic-task.js";

export type Aggregation = "average" | "latest" | "sum";

export interface SensorConfig {
  type: string;
  disabled?: boolean;
  sampling: { aggregation: Aggregation };
}

export default abstract class Sensor extends Input {
  reportInterval?: NodeJS.Timeout;
  sampleInterval?: NodeJS.Timeout;
  sensor?: any;
  samples: Array<any> | Record<string, Array<any>>;
  config: SensorConfig;
  name: string;
  enabled: boolean;
  abstract enable(): Promise<void>;
  abstract sample(): Promise<void>;
  abstract collateSamples(): any;

  constructor(config: SensorConfig, task: Task) {
    super(config, task);

    this.reportInterval = undefined;
    this.sampleInterval = undefined;
    this.sensor = undefined;
    this.samples = [];
  }

  async register() {
    if (!this.config.disabled && !this.task.disabled) {
      this.enable();
    }
  }

  async publishReading() {
    if (
      get(this.config, "sampling") === undefined ||
      this.samples.length === 0
    ) {
      await this.sample();
    }

    const payload = this.collateSamples();
    this.info(
      { role: "blob", blob: payload },
      `Publishing new ${this.name} data: ${JSON.stringify(payload)}`
    );

    if (this.next) this.next.handleMessage(payload);
    this.samples = [];
  }

  // path => single datapoint
  aggregateMeasurement(path: string, prefixKey = "") {
    const samples =
      !!prefixKey && !(this.samples instanceof Array)
        ? this.samples[prefixKey]
        : this.samples;
    const result = this.doAggregation(
      map(samples, (sample) => get(sample, path))
    );

    return result;
  }

  // array of numbers => single datapoint
  doAggregation(data: Array<number>) {
    const aggregation =
      data.length === 1 ? "latest" : get(this.config, "sampling.aggregation");

    if (aggregation === "average") {
      return data.reduce((sum, next) => sum + next, 0) / data.length;
    } else if (aggregation === "latest") {
      return data[data.length - 1];
    } else {
      throw new Error(
        `Unsupported aggregation "${aggregation}" for ${data.length} datapoints: ${JSON.stringify(data)}".`
      );
    }
  }

  static doAggregation(data: Array<number>, aggregation: string, path = "") {
    if (data.length === 1) aggregation = "latest";

    if (aggregation === "latest") {
      return get(data[data.length - 1], path, data[data.length - 1]);
    } else if (aggregation === "average") {
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += get(data[i], path, data[i]);
      }
      return sum / data.length;
    } else {
      throw new Error(
        `Unsupported aggregation "${aggregation}" for ${data.length} datapoints: ${JSON.stringify(data)}".`
      );
    }
  }

  setupPublisher() {
    if (this.reportInterval) clearInterval(this.reportInterval);
    this.publishReading().then(() => {
      this.reportInterval = setInterval(
        this.publishReading.bind(this),
        this.getReportingInterval()
      );
    });
  }

  setupSampler() {
    if (this.sampleInterval) clearInterval(this.sampleInterval);
    this.publishReading().then(() => {
      this.sampleInterval = setInterval(
        this.sample.bind(this),
        this.getSamplingInterval()
      );
    });
  }

  getSamplingInterval() {
    return get(this, "config.samplingInterval", 60 * 1000);
  }

  getReportingInterval() {
    return get(this, "config.reportingInterval", 60 * 1000);
  }
}
