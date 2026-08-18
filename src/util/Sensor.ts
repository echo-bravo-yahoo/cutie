import get from "lodash/get.js";
import map from "lodash/map.js";

import Trigger, { TriggerConfig } from "./Trigger.js";
import Task from "./Task.js";
import { newTraceId } from "./trace.js";

export type Aggregation =
  | "average"
  | "latest"
  | "sum"
  | "median"
  | `p${number}`;

export interface SensorConfig extends TriggerConfig {
  sampling: { aggregation: Aggregation };
}

export default abstract class Sensor extends Trigger {
  reportInterval?: NodeJS.Timeout;
  sampleInterval?: NodeJS.Timeout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sensor?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  samples: Array<any> | Record<string, Array<any>>;
  declare config: SensorConfig;
  abstract enable(): Promise<void>;
  abstract sample(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abstract collateSamples(): any;

  constructor(config: SensorConfig, task: Task, index?: number) {
    super(config, task, index);

    this.reportInterval = undefined;
    this.sampleInterval = undefined;
    this.sensor = undefined;
    this.samples = [];
  }

  async publishReading() {
    if (
      get(this.config, "sampling") === undefined ||
      this.samples.length === 0
    ) {
      await this.sample();
    }

    const payload = this.collateSamples();
    const traceId = newTraceId();

    this.info(
      `Publishing new ${this.name} data.`,
      {
        topic: this.config.type,
        traceId,
      },
      payload,
    );
    this.startMessage(payload, traceId);
    this.samples = [];
  }

  // path => single datapoint
  aggregateMeasurement(path: string, prefixKey = "") {
    const samples =
      !!prefixKey && !(this.samples instanceof Array)
        ? this.samples[prefixKey]
        : this.samples;
    const result = this.doAggregation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map(samples, (sample: any) => get(sample, path)),
    );

    return result;
  }

  // array of numbers => single datapoint
  doAggregation(data: Array<number>) {
    return Sensor.doAggregation(data, get(this.config, "sampling.aggregation"));
  }

  static doAggregation(data: Array<number>, aggregation: string, path = "") {
    if (data.length === 1) aggregation = "latest";
    // An empty path makes lodash fall through to the datapoint itself, which
    // is how primitive readings share this code with object readings.
    const values: Array<number> = data.map((datapoint) =>
      get(datapoint, path, datapoint),
    );

    if (aggregation === "latest") {
      return values[values.length - 1];
    } else if (aggregation === "average") {
      return values.reduce((sum, next) => sum + next, 0) / values.length;
    } else if (aggregation === "sum") {
      return values.reduce((sum, next) => sum + next, 0);
    }

    // "median" is p50; "pX" accepts any percentile, integer or fractional.
    const percentile =
      aggregation === "median"
        ? 50
        : Number(/^p([\d.]+)$/.exec(aggregation)?.[1]);

    if (Number.isNaN(percentile) || percentile < 0 || percentile > 100)
      throw new Error(
        `Unsupported aggregation "${aggregation}" for ${data.length} datapoints: ${JSON.stringify(data)}.`,
      );

    // Linear interpolation between closest ranks, matching numpy's default
    // and InfluxDB's PERCENTILE, so aggregated values compare across stores.
    const sorted = [...values].sort((a, b) => a - b);
    const rank = (percentile / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);

    return low === high
      ? sorted[low]
      : sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
  }

  setupPublisher() {
    if (this.reportInterval) clearInterval(this.reportInterval);
    this.publishReading().then(() => {
      this.reportInterval = setInterval(
        this.publishReading.bind(this),
        this.getReportingInterval(),
      );
    });
  }

  // Sampling is not publishing; only setupPublisher emits.
  setupSampler() {
    if (this.sampleInterval) clearInterval(this.sampleInterval);
    this.sampleInterval = setInterval(
      this.sample.bind(this),
      this.getSamplingInterval(),
    );
  }

  getSamplingInterval() {
    return get(this, "config.samplingInterval", 60 * 1000);
  }

  getReportingInterval() {
    return get(this, "config.reportingInterval", 60 * 1000);
  }
}
