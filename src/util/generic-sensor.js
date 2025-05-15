import get from "lodash/get.js";
import map from "lodash/map.js";

import { Module } from "./generic-module.js";

export class Sensor extends Module {
  constructor(stateKey, config) {
    super(stateKey, config);

    this.reportInterval = undefined;
    this.sampleInterval = undefined;
    this.sensor = undefined;
    this.samples = [];
  }

  // path => single datapoint
  aggregateMeasurement(path, prefixKey = "") {
    const samples = !!prefixKey ? this.samples[prefixKey] : this.samples;
    const result = this.doAggregation(
      map(samples, (sample) => get(sample, path))
    );

    return result;
  }

  // array of numbers => single datapoint
  doAggregation(data) {
    const aggregation =
      data.length === 1
        ? "latest"
        : get(this.currentState, "sampling.aggregation");

    if (aggregation === "average") {
      return data.reduce((sum, next) => sum + next, 0) / data.length;
    } else if (aggregation === "latest") {
      return data.pop();
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

  async handleSampling(newState) {
    this.info(
      {},
      `Updating sampling interval from ${this.getSamplingInterval()} to ${newState.sampling.interval}.`
    );
    this.currentState.sampling = newState.sampling;

    // TODO: ideally, this would re-calculate the next invocation to the correct time
    // right now, it sort of just is randomly between (newInterval) and
    // (newInterval+oldInterval)
    this.setupSampler.bind(this)();
  }

  async handleReporting(newState) {
    this.info(
      {},
      `Updating reporting interval from ${this.getReportingInterval()} to ${newState.reporting.interval}.`
    );
    this.currentState.reporting = newState.reporting;

    // TODO: ideally, this would re-calculate the next invocation to the correct time
    // right now, it sort of just is randomly between (newInterval) and
    // (newInterval+oldInterval)
    this.setupPublisher.bind(this)();
  }

  getSamplingInterval() {
    return get(this.currentState, "sampling.interval", 60 * 1000);
  }

  getReportingInterval() {
    return get(this.currentState, "reporting.interval", 60 * 1000);
  }
}
