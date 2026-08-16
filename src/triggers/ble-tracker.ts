import Sensor, { SensorConfig } from "../util/Sensor.js";
import Task from "../util/Task.js";
import { importOptional } from "../util/optional-dependency.js";
import DrunkReader, { DrunkRSSI } from "../util/DrunkReader.js";
// type-only, so no require for this optional dependency survives compilation
import type NodeBle from "node-ble";

let ble: ReturnType<typeof NodeBle.createBluetooth>;
let adapter: NodeBle.Adapter;
const deviceMap: Record<string, NodeBle.Device> = {};

export interface BLEDevice {
  alias?: string;
  macAddress: string;
}

export interface BLETrackerConfig extends SensorConfig {
  devices: Array<BLEDevice>;
  virtual?: boolean;
}

export default class BLETracker extends Sensor {
  declare config: BLETrackerConfig;
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare samples: Record<string, Array<any>>;
  virtualRssi: Record<string, DrunkReader> = {};

  constructor(config: BLETrackerConfig, task: Task) {
    super(config, task);

    // TODO: rewrite this, it's bad
    this.samples = {};
    this.name = "BLETracker";
  }

  collateSamples() {
    const result: Record<string, unknown> = {};
    for (const device of this.config.devices) {
      const key = device.alias || device.macAddress;
      if (this.samples[key]?.length) result[key] = this.aggregateOne(key);
    }

    return result;
  }

  aggregateOne(deviceKey: string) {
    this.info(
      "Aggregating.",
      { topic: this.logPrefix },
      { context: this.samples[deviceKey] },
    );
    const aggregated = {
      metadata: {
        timestamp: new Date(),
      },
      rssi: Number(this.aggregateMeasurement(`rssi.result`, deviceKey)).toFixed(
        0,
      ),
    };
    this.info(
      "Aggregated.",
      { topic: this.logPrefix },
      { before: this.samples[deviceKey], after: aggregated },
    );

    this.samples[deviceKey] = [];

    return aggregated;
  }

  async sampleOne(deviceSpec: BLEDevice) {
    const deviceKey = deviceSpec.alias || deviceSpec.macAddress;
    let rssi = -99;

    if (this.config.virtual) {
      this.virtualRssi[deviceKey] ??= new DrunkRSSI();
      rssi = Number(await this.virtualRssi[deviceKey].read());
    } else if (deviceMap[deviceKey]) {
      try {
        rssi = Number(await deviceMap[deviceKey].getRSSI());
      } catch (_e) {}
    }

    const datapoint = {
      metadata: {
        timestamp: new Date(),
      },
      rssi: {
        raw: rssi,
        result: rssi,
      },
    };

    this.debug("Sampled new data point", { topic: this.logPrefix });
    if (!this.samples[deviceKey] || !this.samples[deviceKey].length)
      this.samples[deviceKey] = [];
    this.samples[deviceKey].push(datapoint);
  }

  async sample() {
    if (!this.enabled) return;

    await this.discoverAdvertisements();

    const promises = [];
    for (const device of this.config.devices) {
      promises.push(this.sampleOne(device));
    }

    await Promise.all(promises);
  }

  // Sensor.publishReading is correct for this sensor now that collateSamples
  // returns a per-device aggregate. The v3 override existed only to reach
  // config.destinations, which v4 replaced with the task's step chain.

  async discoverAdvertisements() {
    if (this.config.virtual) return;

    if (!adapter) {
      const nodeBLE = (
        await importOptional<{ default: typeof NodeBle }>(
          "node-ble",
          "trigger:ble-tracker",
        )
      ).default;
      ble = nodeBLE.createBluetooth();
      adapter = await ble.bluetooth.defaultAdapter();
    }

    if (!(await adapter.isDiscovering())) await adapter.startDiscovery();

    for (const device of this.config.devices) {
      const deviceKey = device.alias || device.macAddress;
      try {
        deviceMap[deviceKey] = await adapter.waitDevice(
          device.macAddress,
          30000,
        );
        this.debug(`Device with key ${deviceKey} found.`, {
          topic: this.logPrefix,
        });
      } catch (_e) {
        this.debug(`No device found for key ${deviceKey}`, {
          topic: this.logPrefix,
        });
        // it's normal for missing devices to timeout
      }
    }
  }

  async enable() {
    await this.discoverAdvertisements();

    this.setupSampler();
    this.setupPublisher();
    this.info("Enabled BLE tracker.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.reportInterval);
    clearInterval(this.sampleInterval);

    if (!this.config.virtual) {
      for (const device of Object.values(deviceMap)) {
        await device.disconnect();
      }
      ble.destroy();
    }

    this.info("Disabled BLE tracker.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "name": "",
  "type": "trigger:ble-tracker",
  "disabled": false,
  "virtual": false,
  "devices": [{ "alias": "", "macAddress": "00:00:00:00:00:00" }],
  "samplingInterval": 10000, // in ms
  "reportingInterval": 60000 // in ms
}
*/
