import Sensor, { SensorConfig } from "../util/Sensor.js";
import Task from "../util/Task.js";

export interface BME680Config extends SensorConfig {
  i2cAddress: number;
}

interface Sample {
  metadata: {
    timestamp: Date;
  };
  temp: number;
  humidity: number;
  pressure: number;
  gas: number;
}

export default class BME680 extends Sensor {
  declare config: BME680Config;
  declare samples: Array<Sample>;

  constructor(config: BME680Config, task: Task) {
    super(config, task);

    this.name = "BME680";
  }

  async sample() {
    if (!this.enabled) return;
    const sensorData = await this.sensor.read();

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
      gas: sensorData.gas_resistance,
    };

    this.debug("Sampled new data point", { topic: this.logPrefix });
    this.samples.push(datapoint);
  }

  async enable() {
    // if (!this.config.virtual) {
    const Bme680 = (await import("bme680-sensor")).default.Bme680;
    this.sensor = new Bme680(1, Number(this.config.i2cAddress) || 0x77);
    await this.sensor.initialize();
    // }

    // TODO: ideally, this would re-calculate the next invocation to the correct time
    // right now, it sort of just is randomly between (newInterval) and
    // (newInterval+oldInterval)
    this.setupPublisher();
    this.setupSampler();
    this.info("Enabled bme680.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);
    // TODO: do I need to turn off the sensor / close the connection?
    this.info("Disabled bme680.", { topic: this.logPrefix });
    this.enabled = false;
  }

  collateSamples() {
    return this.samples;
  }
}

/*
{
  "type": "bme280",
  "disabled": false,
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
