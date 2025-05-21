import get from "lodash/get.js";
import map from "lodash/map.js";

import { Module } from "./generic-module.js";
import { getExchange } from "./exchanges.js";

export class Sensor extends Module {
  constructor(config) {
    super(config);

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

    for (let toFind of this.config.destinations) {
      const found = getExchange(toFind.name);

      if (found) {
        this.info(
          { role: "blob", blob: payload },
          `Publishing new ${this.config.name} data to ${toFind.measurement}: ${JSON.stringify(payload)}`
        );
        found.send(
          toFind.measurement || toFind.topic,
          { ...payload, metadata: undefined, aggregationMetadata: undefined },
          payload.metadata,
          payload.aggregationMetadata
        );
      }
    }

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
      data.length === 1 ? "latest" : get(this.config, "sampling.aggregation");

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

  static doAggregation(data, aggregation, path = "") {
    if (data.length === 1) aggregation = "latest";

    if (aggregation === "latest") {
      return data.pop();
    } else if (aggregation === "average") {
      console.log("path", path);
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
    return get(this.config, "sampling.interval", 60 * 1000);
  }

  getReportingInterval() {
    return get(this.config, "reporting.interval", 60 * 1000);
  }
}
