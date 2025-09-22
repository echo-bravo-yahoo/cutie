import DrunkReader, {
  DrunkHumidity,
  DrunkPressure,
  DrunkTemp,
} from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";

export interface BME680Config extends ReadConfig {
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

export default class BME680 extends Read {
  declare config: BME680Config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sensor?: any;
  virtualTemp: DrunkReader;
  virtualHumidity: DrunkReader;
  virtualPressure: DrunkReader;
  virtualGas: DrunkReader;

  constructor(config: BME680Config, task: Task) {
    super(config, task, {});

    this.virtualTemp = new DrunkTemp();
    this.virtualHumidity = new DrunkHumidity();
    this.virtualPressure = new DrunkPressure();
    // TODO: make a decent virtual read config for this
    this.virtualGas = new DrunkPressure();

    this.name = "BME680";
  }

  async virtualRead() {
    return {
      metadata: {
        timestamp: new Date(),
      },
      temp: await this.virtualTemp.read(),
      humidity: await this.virtualHumidity.read(),
      pressure: await this.virtualPressure.read(),
      gas: await this.virtualGas.read(),
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
      gas: sensorData.gas_resistance,
    };

    this.debug(
      `Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`,
      { topic: this.logPrefix },
    );

    return datapoint;
  }

  async enable() {
    // if (!this.config.virtual) {
    const Bme680 = (await import("bme680-sensor")).default.Bme680;
    this.sensor = new Bme680(1, Number(this.config.i2cAddress) || 0x77);
    await this.sensor.initialize();
    // }

    this.info("Enabled bme680.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    // TODO: do I need to turn off the sensor / close the connection?
    this.info("Disabled bme680.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "bme280",
  "disabled": false,
  "i2cAddress": 0x77
}
*/
