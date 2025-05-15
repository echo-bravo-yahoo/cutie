import get from "lodash/get.js";

import { globals } from "../index.js";
import { Temp } from "../util/temp.js";
import { Sensor } from "../util/generic-sensor.js";

export default class BME280 extends Sensor {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.config.enabled) {
      this.enable();
    }
  }

  aggregate() {
    const aggregation =
      this.samples.length === 1
        ? "latest"
        : get(this.config, "sampling.aggregation", "average");

    this.info({ blob: this.samples }, `Aggregating.`);
    const aggregated = {
      metadata: {
        name: globals.name,
        island: globals.name,
        location: globals.location,
        timestamp: new Date(),
      },
      aggregationMetadata: {
        samples: this.samples.length,
        aggregation,
        offsets: {
          temp: get(this.config, "offsets.temp", 0),
          humidity: get(this.config, "offsets.humidity", 0),
          pressure: get(this.config, "offsets.pressure", 0),
        },
      },
      temp: new Temp(this.aggregateMeasurement("temp.result"), "f").value({
        precision: 2,
      }),
      humidity: Number(this.aggregateMeasurement("humidity.result")).toFixed(2),
      pressure: Number(this.aggregateMeasurement("pressure.result")).toFixed(2),
    };

    this.samples = [];

    return aggregated;
  }

  async sample() {
    if (!this.config.enabled) return;
    const sensorData = await this.sensor.read();

    const datapoint = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      temp: {
        raw: sensorData.temperature,
        converted: new Temp(sensorData.temperature, "c").to("f").value(),
        offset: get(this.config, "offsets.temp"),
        result: new Temp(sensorData.temperature, "c")
          .to("f")
          .add(get(this.config, "offsets.temp", 0), "f")
          .value(),
      },
      humidity: {
        raw: sensorData.humidity,
        offset: get(this.config, "offsets.humidity", 0),
        result: sensorData.humidity + get(this.config, "offsets.humidity", 0),
      },
      pressure: {
        raw: sensorData.pressure,
        offset: get(this.config, "offsets.pressure", 0),
        result: sensorData.pressure + get(this.config, "offsets.pressure", 0),
      },
    };

    this.debug({}, `Sampled new data point`);
    this.samples.push(datapoint);
  }

  async enable() {
    const bme280Sensor = await import("bme280");
    this.sensor = await bme280Sensor.open({
      i2cAddress: Number(this.config.i2cAddress) || 0x76,
    });
    this.setupPublisher();
    this.info({}, `Enabled bme280.`);
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.interval);
    if (this.sensor) await this.sensor.close();
    this.info({}, `Disabled bme280.`);
    this.enabled = false;
  }
}

/*
{
  "enabled": true,
  "offsets": {
    "temp": "",
    "gas": "",
    "light": "",
    "sound": "",
    "humidity": "",
    "pressure": ""
  },
  "sampling": {
    "interval": "",
    "aggregation": "latest|average|median|pX"
  },
  "reporting": {
    "interval": ""
  }
}
*/
