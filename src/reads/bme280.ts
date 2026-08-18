import DrunkReader, {
  DrunkHumidity,
  DrunkPressure,
  DrunkTemp,
} from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { ModuleSchema } from "../util/schema.js";

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

  constructor(config: BME280Config, task: Task, index?: number) {
    super(config, task, index);

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

  // The base class routes to virtualRead when `virtual` is set, and a disabled
  // step is no longer in the chain at all, so neither guard belongs here.
  async read(_message: Message, traceId: string) {
    const sensorData = await this.sensor.read();

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      temp: sensorData.temperature,
      humidity: sensorData.humidity,
      pressure: sensorData.pressure,
    };

    this.debug(`Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`, {
      topic: this.logPrefix,
      traceId,
    });

    return datapoint;
  }

  async enable() {
    if (!this.config.virtual) {
      const bme280Sensor = await importOptional<{
        open(options: { i2cAddress: number }): Promise<unknown>;
      }>("bme280", "read:bme280");
      this.sensor = await bme280Sensor.open({
        i2cAddress: Number(this.config.i2cAddress),
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

export const schema: ModuleSchema = {
  type: "read:bme280",
  description:
    "Reads temperature, humidity, and pressure from a BME280 over I2C.",
  options: {
    virtual: {
      type: "boolean",
      description:
        "Produce plausible drifting readings instead of opening the sensor.",
      default: false,
    },
    i2cAddress: {
      type: "number",
      description:
        "The sensor's I2C address; a BME280 uses 0x76 or 0x77 depending on its SDO pin.",
      default: 0x76,
      // 0x00 to 0x07 are reserved by the I2C spec, so no device answers there.
      min: 0x08,
      max: 0x77,
      integer: true,
    },
  },
};
