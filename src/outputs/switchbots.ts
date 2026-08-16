import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";

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

export interface BotConfig {
  // matched against the device's id or its MAC address, whichever the
  // discovery reports
  id: string;
  name?: string;
  // some bots are mounted so that "on" is physically the arm raised
  reverseOnOff?: boolean;
}

export interface SwitchbotsConfig extends OutputConfig {
  bots: Array<BotConfig>;
  discoveryTimeout?: number;
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

  constructor(config: SwitchbotsConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: SwitchbotsConfig): SwitchbotsConfig {
    return {
      discoveryTimeout: DEFAULT_DISCOVERY_TIMEOUT_MS,
      ...config,
    };
  }

  getBot(id: string): BotConfig {
    const bot = this.config.bots?.find((candidate) => candidate.id === id);
    if (!bot)
      throw new Error(
        `No switchbot configured with id "${id}"; known ids are ${JSON.stringify((this.config.bots || []).map((candidate) => candidate.id))}.`,
      );

    return bot;
  }

  botToNameString(bot: BotConfig) {
    return bot.name ? `${bot.name} (${bot.id})` : bot.id;
  }

  // "on" and "off" are what a config asks for; raising and lowering the arm is
  // what the hardware does, and the mapping flips for a reverse-mounted bot.
  static toHandMotion(on: boolean, reverseOnOff?: boolean): "handUp" | "handDown" {
    return on === !reverseOnOff ? "handDown" : "handUp";
  }

  async send(message: Message) {
    const request = message as unknown as BotRequest | undefined;
    if (!request?.id || !request.action)
      throw new Error(
        `A switchbot request needs an id and an action; got ${JSON.stringify(message)}.`,
      );

    const bot = this.getBot(request.id);
    const device = this.config.virtual ? undefined : this.devices[bot.id];
    if (!this.config.virtual && !device)
      throw new Error(
        `Switchbot ${this.botToNameString(bot)} was never discovered; is it in range?`,
      );

    if (request.action === "press") {
      this.info(`Pressing switchbot ${this.botToNameString(bot)}.`, {
        topic: this.logPrefix,
      });
      if (device) await device.press();

      return message;
    }

    const motion = Switchbots.toHandMotion(
      request.action === "on",
      bot.reverseOnOff,
    );
    this.info(
      `Turning switchbot ${this.botToNameString(bot)} ${request.action} (${motion}).`,
      { topic: this.logPrefix },
    );
    if (device) await device[motion]();

    return message;
  }

  // Binds each configured bot to a discovered device, by whichever of id or
  // MAC address the discovery reported.
  async discover() {
    const wanted = new Set((this.config.bots || []).map((bot) => bot.id));
    const found: Array<SwitchbotDevice> = await this.switchbot.discover({
      timeout: this.config.discoveryTimeout,
    });

    for (const device of found) {
      const key = [device.id, device.mac].find(
        (candidate) => candidate !== undefined && wanted.has(candidate),
      );
      if (key === undefined) continue;

      wanted.delete(key);
      this.devices[key] = device;
      this.debug(`Discovered switchbot ${key} (${device.deviceType}).`, {
        topic: this.logPrefix,
      });
    }

    if (wanted.size)
      throw new Error(
        `Could not discover switchbots ${JSON.stringify([...wanted])}.`,
      );

    this.info("All switchbots discovered.", { topic: this.logPrefix });
  }

  async enable() {
    if (!this.config.virtual) {
      const { SwitchBot } = await importOptional<{
        SwitchBot: SwitchbotClient;
      }>("node-switchbot", "output:switchbots");
      this.switchbot = new SwitchBot({
        scanTimeout: this.config.discoveryTimeout,
      });

      this.info(
        `Enabling switchbots to control ${(this.config.bots || []).length} bots...`,
        { topic: this.logPrefix },
      );
      await this.discover();
    }

    this.enabled = true;
  }

  async disable() {
    if (this.switchbot) await this.switchbot.cleanup();
    this.switchbot = undefined;
    this.devices = {};
    this.info("Disabled switchbots.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "output:switchbots",
  "disabled": false,
  "virtual": false,
  "discoveryTimeout": 10000,
  "bots": [
    {
      "id": "f84e19c8c70d",
      "name": "kitchen light",
      "reverseOnOff": true
    }
  ]
}

The message names a bot and an action: {"id": "f84e19c8c70d", "action": "on"},
where action is "on", "off", or "press". Wire a trigger:mqtt per action rather
than the per-bot topics the v3 module subscribed to itself.
*/
