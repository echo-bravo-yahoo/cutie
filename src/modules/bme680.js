import { globals } from "../index.js";
import { Sensor } from "../util/generic-sensor.js";

export class BME680 extends Sensor {
  constructor(config) {
    super(config);
  }

  async register() {
    if (this.enabled) {
      this.enable();
    }
  }

  async sample() {
    if (!this.enabled) return;
    const sensorData = await this.sensor.read();

    const datapoint = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
      gas: sensorData.gas_resistance,
    };

    this.debug({}, `Sampled new data point`);
    this.samples.push(datapoint);
  }

  async enable() {
    if (!this.config.virtual) {
      const Bme680 = (await import("bme680-sensor")).default.Bme680;
      this.sensor = new Bme680(1, Number(this.config.i2cAddress) || 0x77);
      await this.sensor.initialize();
    }

    // TODO: ideally, this would re-calculate the next invocation to the correct time
    // right now, it sort of just is randomly between (newInterval) and
    // (newInterval+oldInterval)
    this.setupPublisher();
    this.setupSampler();
    this.info({}, `Enabled bme680.`);
    this.enabled = true;
  }

  async disable() {
    // TODO: do I need to turn off the sensor / close the connection?
    clearInterval(this.interval);
    this.info({}, `Disabled bme680.`);
    this.enabled = false;
  }
}

export default BME680;
