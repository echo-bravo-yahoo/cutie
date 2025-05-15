import get from "lodash/get.js";

import { globals } from "../index.js";
import { Temp } from "../util/temp.js";
import { Sensor } from "../util/generic-sensor.js";

export class BME680 extends Sensor {
  constructor(config) {
    super(config);
  }

  async register() {
    this.currentState = get(globals, `state["${this.stateKey}"]`, {
      enabled: false,
    });

    if (this.currentState.enabled) {
      this.enable();
    }
  }

  aggregate() {
    const aggregation =
      this.samples.length === 1
        ? "latest"
        : get(this.currentState, "sampling.aggregation", "average");

    const aggregated = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      aggregationMetadata: {
        samples: this.samples.length,
        aggregation,
        offsets: {
          temp: get(this.currentState, "offsets.temp", 0),
          humidity: get(this.currentState, "offsets.humidity", 0),
          pressure: get(this.currentState, "offsets.pressure", 0),
          gas: get(this.currentState, "offsets.gas", 0),
        },
      },
      temp: new Temp(this.aggregateMeasurement("temp.result")).value({
        precision: 2,
      }),
      humidity:
        this.aggregateMeasurement("humidity.result") +
        get(this.currentState, "offsets.humidity", 0),
      pressure:
        this.aggregateMeasurement("pressure.result") +
        get(this.currentState, "offsets.pressure", 0),
      gas:
        this.aggregateMeasurement("gas") +
        get(this.currentState, "offsets.gas", 0),
    };

    this.samples = [];

    return aggregated;
  }

  async sample() {
    if (!this.currentState.enabled) return;
    const sensorData = await this.sensor.read();

    const datapoint = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      temp: {
        raw: sensorData.temperature,
        converted: new Temp(sensorData.temperature, "c").to("f").value(),
        offset: get(this.currentState, "offsets.temp"),
        result: new Temp(sensorData.temperature, "c")
          .to("f")
          .add(get(this.currentState, "offsets.temp", 0), "f")
          .value(),
      },
      humidity: {
        raw: sensorData.humidity,
        offset: get(this.currentState, "offsets.humidity", 0),
        result:
          sensorData.humidity + get(this.currentState, "offsets.humidity", 0),
      },
      pressure: {
        raw: sensorData.pressure,
        offset: get(this.currentState, "offsets.pressure", 0),
        result:
          sensorData.pressure + get(this.currentState, "offsets.pressure", 0),
      },
      gas: {
        raw: sensorData.gas_resistance,
        offset: get(this.currentState, "offsets.gas", 0),
        result:
          sensorData.gas_resistance + get(this.currentState, "offsets.gas", 0),
      },
    };

    this.debug({}, `Sampled new data point`);
    this.samples.push(datapoint);
  }

  async enable() {
    if (!this.currentState.virtual) {
      const Bme680 = (await import("bme680-sensor")).default.Bme680;
      this.sensor = new Bme680(1, Number(this.currentState.i2cAddress) || 0x77);
      await this.sensor.initialize();
    }

    // TODO: ideally, this would re-calculate the next invocation to the correct time
    // right now, it sort of just is randomly between (newInterval) and
    // (newInterval+oldInterval)
    this.setupPublisher();
    this.info({}, `Enabled bme680.`);
    this.currentState.enabled = true;
  }

  async disable() {
    // TODO: do I need to turn off the sensor / close the connection?
    clearInterval(this.interval);
    this.info({}, `Disabled bme680.`);
    this.currentState.enabled = false;
  }
}

export default BME680;
