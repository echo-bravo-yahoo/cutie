import Sensor, { SensorConfig } from "../util/generic-sensor.js";
import Task from "../util/generic-task.js";

export interface BME280Config extends SensorConfig {
  i2cAddress: number;
}

export default class BME280 extends Sensor {
  config: BME280Config;
  samples: Array<any>;

  constructor(config: BME280Config, task: Task) {
    super(config, task);

    this.name = "BME280";
  }

  async sample() {
    if (this.config.disabled) return;
    const sensorData = await this.sensor.read();

    const datapoint = {
      metadata: {
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
    };

    this.samples.push(datapoint);
    this.debug(
      {},
      `Sampled new data point, ${JSON.stringify(this.samples, null, 2)}`
    );
  }

  async enable() {
    const bme280Sensor = await import("bme280");
    this.sensor = await bme280Sensor.open({
      i2cAddress: Number(this.config.i2cAddress) || 0x76,
    });
    this.setupSampler();
    this.setupPublisher();
    this.info("Enabled bme280.");
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);
    if (this.sensor) await this.sensor.close();
    this.info("Disabled bme280.");
    this.enabled = false;
  }

  collateSamples() {
    return this.samples;
  }

  async handleMessage(message: any) {
    if (this.next) this.next.handleMessage(message);
  }
}

/*
{
  "type": "bme280",
  "disabled": false,
  "i2cAddress": 0x76,
  "sampling": {
    "interval": "",
  },
  "reporting": {
    "interval": ""
  }
}
*/
