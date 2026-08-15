import DrunkReader, {
  DrunkHumidity,
  DrunkPressure,
  DrunkTemp,
} from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";

export interface BME280Config extends ReadConfig {
  i2cAddress: number;
}

interface Sample {
  metadata: {
    timestamp: Date;
  };
  temp: number;
  humidity: number;
  pressure: number;
}

export default class BME280 extends Read {
  declare config: BME280Config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sensor?: any;
  virtualTemp: DrunkReader;
  virtualHumidity: DrunkReader;
  virtualPressure: DrunkReader;

  constructor(config: BME280Config, task: Task) {
    super(config, task, {});

    this.virtualTemp = new DrunkTemp();
    this.virtualHumidity = new DrunkHumidity();
    this.virtualPressure = new DrunkPressure();

    this.name = "BME280";
  }

  async virtualRead() {
    return {
      metadata: {
        timestamp: new Date(),
      },
      temp: await this.virtualTemp.read(),
      humidity: await this.virtualHumidity.read(),
      pressure: await this.virtualPressure.read(),
    };
  }

  async read() {
    if (!this.enabled) return;
    if (this.config.virtual) return this.virtualRead();
    const sensorData = await this.sensor.read();

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
    };

    this.debug(
      `Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`,
      { topic: this.logPrefix },
    );

    return datapoint;
  }

  async enable() {
    if (!this.config.virtual) {
      const bme280Sensor = await import("bme280");
      this.sensor = await bme280Sensor.open({
        i2cAddress: Number(this.config.i2cAddress) || 0x76,
      });
    }

    this.info("Enabled bme280.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    if (this.sensor) await this.sensor.close();
    this.info("Disabled bme280.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "read:bme280",
  "disabled": false,
  "virtual": false,
  "i2cAddress": 0x76
}
*/
