import { globals } from "../index.js";
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

  async sample() {
    if (!this.config.enabled) return;
    const sensorData = await this.sensor.read();

    const datapoint = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
    };

    this.debug({}, `Sampled new data point`);
    this.samples.push(datapoint);
  }

  async enable() {
    const bme280Sensor = await import("bme280");
    this.sensor = await bme280Sensor.open({
      i2cAddress: Number(this.config.i2cAddress) || 0x76,
    });
    this.setupSampler();
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
  "i2cAddress": 0x76,
  "sampling": {
    "interval": "",
  },
  "reporting": {
    "interval": ""
  }
}
*/
