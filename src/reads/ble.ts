import DrunkReader, { DrunkRSSI } from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { parseDuration } from "../util/duration.js";
import { ModuleSchema } from "../util/schema.js";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 10000;

// node-ble ships types but is an optional dependency, so importing them would
// make the build depend on a package that may not be installed. These describe
// only the slice this module drives -- advertisement signal strength, with no
// GATT connection. node-ble types getRSSI as a string while BlueZ answers with
// an int16, hence the union.
interface BluetoothDevice {
  getRSSI(): Promise<number | string>;
}

interface BluetoothAdapter {
  isDiscovering(): Promise<boolean>;
  startDiscovery(): Promise<void>;
  waitDevice(address: string, timeout?: number): Promise<BluetoothDevice>;
}

interface BluetoothSession {
  bluetooth: {
    defaultAdapter(): Promise<BluetoothAdapter>;
    getAdapter(adapter: string): Promise<BluetoothAdapter>;
  };
  destroy(): void;
}

export interface DeviceConfig {
  address: string;
  label?: string;
}

export interface BLEConfig extends ReadConfig {
  devices: Array<DeviceConfig>;
  adapter?: string;
  discoveryTimeout?: number | string;
}

interface Sample {
  metadata: {
    timestamp: Date;
  };
  devices: Record<string, { rssi: number }>;
}

export default class BLE extends Read {
  declare config: BLEConfig;
  session?: BluetoothSession;
  adapter?: BluetoothAdapter;
  devices: Record<string, BluetoothDevice> = {};
  virtualRssi: Record<string, DrunkReader> = {};
  discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS;

  constructor(config: BLEConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  static keyOf(device: DeviceConfig) {
    return device.label ?? device.address;
  }

  // `devices` entries are objects, so their keys are past where a schema can
  // reach; a missing address has to be caught here.
  async register() {
    await super.register();

    this.discoveryTimeoutMs = parseDuration(
      this.config.discoveryTimeout,
      "discoveryTimeout",
    );

    for (const device of this.config.devices ?? [])
      if (typeof device.address !== "string")
        throw new Error(
          `"read:ble": every "devices" entry needs an "address", the device's MAC address.`,
        );
  }

  async readOne(device: DeviceConfig, traceId: string) {
    try {
      this.devices[device.address] ??= await this.adapter!.waitDevice(
        device.address,
        this.discoveryTimeoutMs,
      );

      const rssi = Number(await this.devices[device.address].getRSSI());

      return Number.isFinite(rssi) ? rssi : undefined;
    } catch {
      // BlueZ drops a device's RSSI once it stops advertising, so a device that
      // has gone out of range throws here rather than reporting a stale value.
      this.debug(`No signal from ${BLE.keyOf(device)}.`, { traceId });

      return undefined;
    }
  }

  // The base class routes to virtualRead when `virtual` is set, and a disabled
  // step is no longer in the chain at all, so neither guard belongs here.
  async read(_message: Message, traceId: string) {
    // Discovery is what keeps advertisements arriving, and it does not
    // necessarily survive from one reading to the next.
    if (!(await this.adapter!.isDiscovering()))
      await this.adapter!.startDiscovery();

    const devices: Record<string, { rssi: number }> = {};

    await Promise.all(
      (this.config.devices ?? []).map(async (device) => {
        const rssi = await this.readOne(device, traceId);
        if (rssi !== undefined) devices[BLE.keyOf(device)] = { rssi };
      }),
    );

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      devices,
    };

    this.debug(
      `Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`,
      { traceId },
    );

    return datapoint;
  }

  async virtualRead() {
    const devices: Record<string, { rssi: number }> = {};

    for (const device of this.config.devices ?? []) {
      const key = BLE.keyOf(device);
      this.virtualRssi[key] ??= new DrunkRSSI();
      // A radio reports RSSI as a whole number of dBm; the walk is continuous.
      devices[key] = {
        rssi: Math.round(Number(await this.virtualRssi[key].read())),
      };
    }

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      devices,
    };

    return datapoint;
  }

  async enable() {
    if (!this.config.virtual) {
      const { createBluetooth } = (
        await importOptional<{
          default: { createBluetooth: () => BluetoothSession };
        }>("node-ble", "read:ble")
      ).default;

      this.session = createBluetooth();
      this.adapter = this.config.adapter
        ? await this.session.bluetooth.getAdapter(this.config.adapter)
        : await this.session.bluetooth.defaultAdapter();

      if (!(await this.adapter.isDiscovering()))
        await this.adapter.startDiscovery();
    }

    this.info("Enabled ble.");
    this.enabled = true;
  }

  async disable() {
    // The session, the adapter, and the device handles all belong to this
    // instance, so tearing them down leaves another task's BLE reads running.
    this.session?.destroy();
    this.session = undefined;
    this.adapter = undefined;
    this.devices = {};

    this.info("Disabled ble.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:ble",
  description:
    'Reads the Bluetooth signal strength of named devices, one sample per call, as {"devices": {"a name": {"rssi": -63}}}. A device that is not seen is left out rather than reported at a floor value. Pair it with trigger:cron, and with transform:accumulate and transform:aggregate to average a run of samples.',
  options: {
    devices: {
      type: "array",
      description:
        'The devices to read, each {"address": "00:00:00:00:00:00", "label": "a name"}. The label, when given, is the key that device\'s reading is reported under; the address is used otherwise.',
      required: true,
    },
    adapter: {
      type: "string",
      description:
        'Which Bluetooth adapter to scan with, such as "hci0". The system default adapter is used when this is not set.',
    },
    discoveryTimeout: {
      type: "any",
      description:
        'How long to wait for a configured device to turn up before leaving it out of the reading, as a number of milliseconds or a string with a unit such as "10s".',
      default: DEFAULT_DISCOVERY_TIMEOUT_MS,
      unit: "ms",
    },
    virtual: {
      type: "boolean",
      description:
        "Produce plausible drifting signal strengths instead of scanning for Bluetooth devices.",
      default: false,
    },
  },
};
