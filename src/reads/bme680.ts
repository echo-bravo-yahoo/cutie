import DrunkReader, {
  DrunkGasResistance,
  DrunkHumidity,
  DrunkPressure,
  DrunkTemp,
} from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { ModuleSchema } from "../util/schema.js";

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

  constructor(config: BME680Config, task: Task, index?: number) {
    super(config, task, index);

    this.virtualTemp = new DrunkTemp();
    this.virtualHumidity = new DrunkHumidity();
    this.virtualPressure = new DrunkPressure();
    this.virtualGas = new DrunkGasResistance();

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

  // The base class routes to virtualRead when `virtual` is set, and a disabled
  // step is no longer in the chain at all, so neither guard belongs here.
  async read(_message: Message, traceId: string) {
    // bme680-sensor exposes getSensorData(), not read(), and returns its whole
    // state object - readings sit under .data, alongside calibration data and
    // gas heater settings.
    const { data } = await this.sensor.getSensorData();

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      temp: data.temperature,
      humidity: data.humidity,
      pressure: data.pressure,
      gas: data.gas_resistance,
    };

    this.debug(
      `Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`,
      {
        topic: this.logPrefix,
        traceId,
      },
    );

    return datapoint;
  }

  async enable() {
    if (!this.config.virtual) {
      const Bme680 = (
        await importOptional<{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          default: { Bme680: new (bus: number, address: number) => any };
        }>("bme680-sensor", "read:bme680")
      ).default.Bme680;
      this.sensor = new Bme680(1, Number(this.config.i2cAddress));
      await this.sensor.initialize();
    }

    this.info("Enabled bme680.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    if (this.sensor?.close) await this.sensor.close();
    this.info("Disabled bme680.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:bme680",
  description:
    "Reads temperature, humidity, pressure, and gas resistance from a BME680 over I2C.",
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
        "The sensor's I2C address; a BME680 uses 0x76 or 0x77 depending on its SDO pin.",
      default: 0x77,
      // 0x00 to 0x07 are reserved by the I2C spec, so no device answers there.
      min: 0x08,
      max: 0x77,
      integer: true,
    },
  },
};
