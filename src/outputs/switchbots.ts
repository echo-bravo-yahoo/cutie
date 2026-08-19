import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { parseDuration } from "../util/duration.js";
import { ModuleSchema } from "../util/schema.js";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 10000;

// node-switchbot ships types but is an optional dependency, so importing them
// would make the build depend on a package that may not be installed. These
// describe only the slice this module drives -- a Bot (WoHand).
/* eslint-disable @typescript-eslint/no-explicit-any */
type SwitchbotClient = any;
interface SwitchbotDevice {
  id?: string;
  mac?: string;
  name: string;
  deviceType: string;
  press(): Promise<boolean>;
  handUp(): Promise<boolean>;
  handDown(): Promise<boolean>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface DeviceConfig {
  // matched against the device's id or its MAC address, whichever the
  // discovery reports
  address: string;
  label?: string;
  // some bots are mounted so that "on" is physically the arm raised
  reverseOnOff?: boolean;
}

export interface SwitchbotsConfig extends OutputConfig {
  devices: Array<DeviceConfig>;
  discoveryTimeout?: number | string;
  virtual?: boolean;
}

export type BotAction = "on" | "off" | "press";

export interface BotRequest {
  id: string;
  action: BotAction;
}

export default class Switchbots extends Output {
  declare config: SwitchbotsConfig;
  switchbot?: SwitchbotClient;
  devices: Record<string, SwitchbotDevice> = {};
  discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS;

  constructor(config: SwitchbotsConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // `devices` entries are objects, so their keys are past where a schema can
  // reach; the two old names have to be rejected here.
  async register() {
    this.discoveryTimeoutMs = parseDuration(
      this.config.discoveryTimeout,
      "discoveryTimeout",
    );

    for (const device of this.config.devices ?? []) {
      for (const [old, current] of [
        ["id", "address"],
        ["name", "label"],
      ] as const)
        if ((device as unknown as Record<string, unknown>)[old] !== undefined)
          throw new Error(
            `"output:switchbots": a "devices" entry does not accept "${old}"; use "${current}" instead.`,
          );

      if (device.address === undefined)
        throw new Error(
          `"output:switchbots": every "devices" entry needs an "address", the device's id or MAC address.`,
        );
    }
  }

  getDevice(address: string): DeviceConfig {
    const device = this.config.devices?.find(
      (candidate) => candidate.address === address,
    );
    if (!device)
      throw new Error(
        `No switchbot configured with address "${address}"; known addresses are ${JSON.stringify((this.config.devices || []).map((candidate) => candidate.address))}.`,
      );

    return device;
  }

  deviceToNameString(device: DeviceConfig) {
    return device.label
      ? `${device.label} (${device.address})`
      : device.address;
  }

  // "on" and "off" are what a config asks for; raising and lowering the arm is
  // what the hardware does, and the mapping flips for a reverse-mounted bot.
  static toHandMotion(
    on: boolean,
    reverseOnOff?: boolean,
  ): "handUp" | "handDown" {
    return on === !reverseOnOff ? "handDown" : "handUp";
  }

  async send(message: Message, traceId: string) {
    const request = message as unknown as BotRequest | undefined;
    if (!request?.id || !request.action)
      throw new Error(
        `A switchbot request needs an id and an action; got ${JSON.stringify(message)}.`,
      );

    const configured = this.getDevice(request.id);
    const device = this.config.virtual
      ? undefined
      : this.devices[configured.address];
    if (!this.config.virtual && !device)
      throw new Error(
        `Switchbot ${this.deviceToNameString(configured)} was never discovered; is it in range?`,
      );

    if (request.action === "press") {
      this.info(`Pressing switchbot ${this.deviceToNameString(configured)}.`, {
        traceId,
      });
      if (device) await device.press();

      return message;
    }

    const motion = Switchbots.toHandMotion(
      request.action === "on",
      configured.reverseOnOff,
    );
    this.info(
      `Turning switchbot ${this.deviceToNameString(configured)} ${request.action} (${motion}).`,
      { traceId },
    );
    if (device) await device[motion]();

    return message;
  }

  // Binds each configured device to a discovered one, by whichever of id or
  // MAC address the discovery reported.
  async discover() {
    const wanted = new Set(
      (this.config.devices || []).map((device) => device.address),
    );
    const found: Array<SwitchbotDevice> = await this.switchbot.discover({
      timeout: this.discoveryTimeoutMs,
    });

    for (const device of found) {
      const key = [device.id, device.mac].find(
        (candidate) => candidate !== undefined && wanted.has(candidate),
      );
      if (key === undefined) continue;

      wanted.delete(key);
      this.devices[key] = device;
      this.debug(`Discovered switchbot ${key} (${device.deviceType}).`);
    }

    if (wanted.size)
      throw new Error(
        `Could not discover switchbots ${JSON.stringify([...wanted])}.`,
      );

    this.info("All switchbots discovered.");
  }

  async enable() {
    if (!this.config.virtual) {
      const { SwitchBot } = await importOptional<{
        SwitchBot: SwitchbotClient;
      }>("node-switchbot", "output:switchbots");
      this.switchbot = new SwitchBot({
        scanTimeout: this.discoveryTimeoutMs,
      });

      this.info(
        `Enabling switchbots to control ${(this.config.devices || []).length} devices...`,
      );
      await this.discover();
    }

    this.enabled = true;
  }

  async disable() {
    if (this.switchbot) await this.switchbot.cleanup();
    this.switchbot = undefined;
    this.devices = {};
    this.info("Disabled switchbots.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "output:switchbots",
  description:
    'Presses or toggles SwitchBot bots over Bluetooth. The message names one and an action: {"id": "f84e19c8c70d", "action": "on"}, where the action is "on", "off", or "press".',
  options: {
    devices: {
      type: "array",
      description:
        'The bots to control, each {"address", "label", "reverseOnOff"}. The address is the device id or MAC address the discovery reports; the label is only for the logs.',
      required: true,
    },
    discoveryTimeout: {
      type: "any",
      description:
        'How long to scan for the configured bots before giving up, as a number of milliseconds or a string with a unit such as "10s".',
      default: DEFAULT_DISCOVERY_TIMEOUT_MS,
      unit: "ms",
    },
    virtual: {
      type: "boolean",
      description:
        "Log what would be pressed without scanning for or driving any device.",
      default: false,
    },
  },
};
