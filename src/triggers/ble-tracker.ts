import Sensor, { SensorConfig } from "../util/Sensor.js";
import Task from "../util/Task.js";
import NodeBle from "node-ble";

let ble: ReturnType<typeof NodeBle.createBluetooth>;
let adapter: NodeBle.Adapter;
const deviceMap: Record<string, NodeBle.Device> = {};

export interface BLEDevice {
  alias?: string;
  macAddress: string;
}

export interface BLETrackerConfig extends SensorConfig {
  devices: Array<BLEDevice>;
}

export default class BLETracker extends Sensor {
  declare config: BLETrackerConfig;
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare samples: Record<string, Array<any>>;
  interval?: NodeJS.Timeout;

  constructor(config: BLETrackerConfig, task: Task) {
    super(config, task);

    // TODO: rewrite this, it's bad
    this.samples = {};
    this.name = "BLETracker";
  }

  collateSamples() {
    return undefined;
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

    if (deviceMap[deviceKey]) {
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

  // async publishOne(deviceKey: string) {
  //   const payload = this.aggregateOne(deviceKey);

  //   // real clumsy hack: this is copied from util/generic-sensor until i get sampling one/many
  //   // working well
  //   for (let toFind of this.config.destinations) {
  //     const found = getConnection(toFind.name);

  //     if (found) {
  //       this.info(
  //         { role: "blob", blob: payload },
  //         `Publishing new ${this.config.name} data to ${toFind.measurement}: ${JSON.stringify(payload)}`
  //       );
  //       found.send(
  //         toFind.measurement,
  //         { ...payload, metadata: undefined, aggregationMetadata: undefined },
  //         payload.metadata,
  //         payload.aggregationMetadata
  //       );
  //     }
  //   }
  // }

  async publishReading() {
    // const firstDeviceSamples = Object.values(this.samples)[0];
    // if (
    //   get(this.config, "sampling") === undefined ||
    //   !firstDeviceSamples ||
    //   firstDeviceSamples.length === 0
    // ) {
    //   await this.sample();
    // }
    // for (let deviceSpec of this.config.devices) {
    //   const deviceKey = deviceSpec.alias || deviceSpec.macAddress;
    //   this.publishOne(deviceKey);
    // }
  }

  async discoverAdvertisements() {
    if (!adapter) {
      const nodeBLE = (await import("node-ble")).default;
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

    this.setupPublisher();
    this.info("Enabled BLE tracker.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    clearInterval(this.interval);
    for (const device of Object.values(deviceMap)) {
      await device.disconnect();
    }
    ble.destroy();

    this.info("Disabled BLE tracker.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "name": "",
  "type": "ble-tracker",
  "disabled": false,
  "devices": [{ "alias": "", "macAddress": "00:00:00:00:00:00" }],
  "sampling": {
    "interval": "",
  },
  "reporting": {
    "interval": ""
  }
}
*/
