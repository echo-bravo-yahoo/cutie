import get from "lodash/get.js";

import { globals } from "../index.js";
import { Sensor } from "../util/generic-sensor.js";

let ble, adapter;
const deviceMap = {};

export class BLETracker extends Sensor {
  constructor(config) {
    super(config);

    this.samples = {};
  }

  async register() {
    if (this.enabled) {
      this.enable();
    }
  }

  aggregateOne(deviceKey) {
    const aggregation =
      this.samples[deviceKey].length === 1
        ? "latest"
        : get(this.config, "sampling.aggregation", "average");

    this.info({ blob: this.samples[deviceKey] }, `Aggregating.`);
    const aggregated = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      aggregationMetadata: {
        samples: this.samples[deviceKey].length,
        aggregation,
      },
      rssi: Number(this.aggregateMeasurement(`rssi.result`, deviceKey)).toFixed(
        0
      ),
    };
    this.info(
      { before: this.samples[deviceKey], after: aggregated },
      `Aggregated.`
    );

    this.samples[deviceKey] = [];

    return aggregated;
  }

  async sampleOne(deviceSpec) {
    const deviceKey = deviceSpec.alias || deviceSpec.macAddress;
    let rssi = -99;

    if (deviceMap[deviceKey]) {
      try {
        rssi = await deviceMap[deviceKey].getRSSI();
      } catch (e) {}
    }

    const datapoint = {
      metadata: {
        island: globals.name,
        timestamp: new Date(),
      },
      rssi: {
        raw: rssi,
        result: rssi,
      },
    };

    this.debug({}, `Sampled new data point`);
    if (!this.samples[deviceKey] || !this.samples[deviceKey].length)
      this.samples[deviceKey] = [];
    this.samples[deviceKey].push(datapoint);
  }

  async sample() {
    if (!this.enabled) return;

    await this.discoverAdvertisements();

    const promises = [];
    for (let device of this.config.devices) {
      promises.push(this.sampleOne(device));
    }

    return Promise.all(promises);
  }

  async publishOne(deviceKey) {
    const payload = this.aggregateOne(deviceKey);

    // real clumsy hack: this is copied from util/generic-sensor until i get sampling one/many
    // working well
    for (let toFind of this.config.destinations) {
      const found = getDestination(toFind.name);

      if (found) {
        this.info(
          { role: "blob", blob: payload },
          `Publishing new ${this.config.name} data to ${toFind.measurement}: ${JSON.stringify(payload)}`
        );
        found.send(
          toFind.measurement,
          { ...payload, metadata: undefined, aggregationMetadata: undefined },
          payload.metadata,
          payload.aggregationMetadata
        );
      }
    }
  }

  async publishReading() {
    const firstDeviceSamples = Object.values(this.samples)[0];
    if (
      get(this.config, "sampling") === undefined ||
      !firstDeviceSamples ||
      firstDeviceSamples.length === 0
    ) {
      await this.sample();
    }

    for (let deviceSpec of this.config.devices) {
      const deviceKey = deviceSpec.alias || deviceSpec.macAddress;
      this.publishOne(deviceKey);
    }
  }

  async discoverAdvertisements() {
    if (!adapter) {
      const nodeBLE = (await import("node-ble")).default;
      ble = nodeBLE.createBluetooth();
      adapter = await ble.bluetooth.defaultAdapter();
    }

    if (!(await adapter.isDiscovering())) await adapter.startDiscovery();

    for (let device of this.config.devices) {
      const deviceKey = device.alias || device.macAddress;
      try {
        deviceMap[deviceKey] = await adapter.waitDevice(
          device.macAddress,
          30000
        );
        this.debug({}, `Device with key ${deviceKey} found.`);
      } catch (e) {
        this.debug({}, `No device found for key ${deviceKey}`);
        // it's normal for missing devices to timeout
      }
    }
  }

  async enable() {
    await this.discoverAdvertisements();

    this.setupPublisher();
    this.info({}, `Enabled BLE tracker.`);
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.interval);
    for (let device of Object.values(deviceMap)) {
      await device.disconnect();
    }
    ble.destroy();

    this.info({}, `Disabled BLE tracker.`);
    this.enabled = false;
  }
}

/*
{
  "enabled": true,
  "macAddress": "00:00:00:00:00:00",
  "alias": "some name to use for the MQTT topic",
  "sampling": {
    "interval": "",
    "aggregation": "latest|average|median|pX"
  },
  "reporting": {
    "interval": ""
  }
}
*/

export default BLETracker;
