import Sensor, { SensorConfig } from "../util/generic-sensor.js";
import Task from "../util/generic-task.js";

export interface BME680Config extends SensorConfig {
  i2cAddress: number;
}

export default class BME680 extends Sensor {
  config: BME680Config;
  samples: Array<any>;

  constructor(config: BME680Config, task: Task) {
    super(config, task);

    this.name = "BME680";
  }

  async sample() {
    if (!this.enabled) return;
    const sensorData = await this.sensor.read();

    const datapoint = {
      metadata: {
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
      gas: sensorData.gas_resistance,
    };

    this.debug("Sampled new data point");
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
    this.info("Enabled bme680.");
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);
    // TODO: do I need to turn off the sensor / close the connection?
    this.info("Disabled bme680.");
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
