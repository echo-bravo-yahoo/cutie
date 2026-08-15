import DrunkReader, {
  DrunkHumidity,
  DrunkPressure,
  DrunkTemp,
} from "../util/DrunkReader.js";
import Sensor, { SensorConfig } from "../util/Sensor.js";
import Task from "../util/Task.js";

export interface BME680Config extends SensorConfig {
  i2cAddress?: number;
  i2cBus?: number;
  virtual?: boolean;
}

export interface BME680Sample {
  metadata: {
    timestamp: Date;
  };
  temp: number;
  humidity: number;
  pressure: number;
  gas: number;
}

// The BME680 as a Trigger, driving its own sampling and reporting intervals.
// `src/reads/bme680.ts` is the same sensor as a Read, pulled by an upstream
// trigger instead. Both exist for the same reason `random` does: which one a
// task wants depends on whether the sensor sets the cadence.
export default class BME680 extends Sensor {
  declare config: BME680Config;
  declare samples: Array<BME680Sample>;
  virtualTemp: DrunkReader;
  virtualHumidity: DrunkReader;
  virtualPressure: DrunkReader;
  virtualGas: DrunkReader;

  constructor(config: BME680Config, task: Task) {
    super(config, task);

    this.virtualTemp = new DrunkTemp();
    this.virtualHumidity = new DrunkHumidity();
    this.virtualPressure = new DrunkPressure();
    // TODO: make a decent virtual read config for gas resistance
    this.virtualGas = new DrunkPressure();

    this.name = "BME680";
  }

  async virtualRead(): Promise<BME680Sample> {
    return {
      metadata: { timestamp: new Date() },
      temp: (await this.virtualTemp.read()) as number,
      humidity: (await this.virtualHumidity.read()) as number,
      pressure: (await this.virtualPressure.read()) as number,
      gas: (await this.virtualGas.read()) as number,
    };
  }

  async read(): Promise<BME680Sample> {
    if (this.config.virtual) return this.virtualRead();

    // bme680-sensor exposes getSensorData(), not read(), and returns its whole
    // state object - readings sit under .data, alongside calibration data and
    // gas heater settings.
    const { data } = await this.sensor.getSensorData();

    return {
      metadata: { timestamp: new Date() },
      temp: data.temperature,
      humidity: data.humidity,
      pressure: data.pressure,
      gas: data.gas_resistance,
    };
  }

  // The samples array is handed to downstream transforms as-is, so
  // `transform:aggregate` in its multi-path form sees an array of composite
  // readings and can aggregate temp, humidity, and pressure independently.
  collateSamples() {
    return this.samples;
  }

  async sample() {
    if (this.config.disabled) return;

    const datapoint = await this.read();

    this.debug(
      "Sampled new data point.",
      { topic: this.logPrefix },
      { datapoint },
    );
    this.samples.push(datapoint);
  }

  async enable() {
    if (!this.config.virtual) {
      // Imported lazily so a host without the sensor - or without the compiled
      // i2c-bus binding - can still load every other task in the config.
      const Bme680 = (await import("bme680-sensor")).default.Bme680;
      this.sensor = new Bme680(
        Number(this.config.i2cBus ?? 1),
        Number(this.config.i2cAddress) || 0x77,
      );
      await this.sensor.initialize();
    }

    this.info("Enabled bme680.", { topic: this.logPrefix });
    this.setupPublisher();
    this.setupSampler();
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);
    this.info("Disabled bme680.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:bme680",
  "disabled": false,
  "i2cAddress": 119,
  "samplingInterval": 10000,
  "reportingInterval": 60000
}
*/
