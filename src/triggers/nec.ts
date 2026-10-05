import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { NECFrameDecoder } from "../util/bitbang/adapters/nec.js";
import {
  getPigpioConnection,
  onPigpioReconnect,
  PigpioClientGpio,
} from "../util/pigpio-client.js";
import { ModuleSchema } from "../util/schema.js";

export interface NECTriggerConfig extends TriggerConfig {
  receiverPin?: number;
  activeLow?: boolean;
  virtual?: boolean;
}

export default class NECTrigger extends Trigger {
  declare config: NECTriggerConfig;
  receiver?: PigpioClientGpio;
  decoder?: NECFrameDecoder;
  private unsubscribeReconnect?: () => void;

  constructor(config: NECTriggerConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // A pin is required only when one is actually watched, which is a pairing
  // no single option's schema can express.
  async register() {
    if (!this.config.virtual && !this.config.receiverPin)
      throw new Error(`"trigger:nec" needs a receiverPin unless virtual.`);
  }

  async enable() {
    if (!this.config.virtual) {
      const pigpioClient = await getPigpioConnection("trigger:nec");

      this.decoder = new NECFrameDecoder(this.config.activeLow);
      this.receiver = pigpioClient.gpio(this.config.receiverPin as number);
      this.receiver.modeSet("input");
      this.receiver.notify((level, tick) => this.handleEdge(level, tick));
      this.unsubscribeReconnect = onPigpioReconnect({
        enable: () => this.enable(),
        disable: () => this.disable(),
      });

      this.info(`Enabled NEC receiver on pin ${this.config.receiverPin}.`);
    }

    this.enabled = true;
  }

  // Broken out of enable()'s notify() registration so a stray edge can be
  // driven directly in a test. endNotify() (in disable(), below) is
  // fire-and-forget -- pigpio-client only drops this pin's notifier from
  // its internal set once pigpiod's stop-notifications response actually
  // arrives -- so a real edge can still land here after disable() has
  // already nulled this.decoder. Guarding it turns that stray edge into a
  // harmless no-op instead of the uncaughtException it used to throw.
  handleEdge(level: number | null, tick: number | null) {
    if (level === null || tick === null) return;
    if (!this.decoder) return;

    const command = this.decoder.consumeEdge(level, tick);
    if (command) this.fire(() => command);
  }

  async disable() {
    this.unsubscribeReconnect?.();
    this.unsubscribeReconnect = undefined;

    if (this.receiver) {
      this.receiver.endNotify();
      this.receiver = undefined;
      this.decoder = undefined;
      this.info("Disabled NEC receiver.");
    }

    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:nec",
  description:
    "Decodes an NEC infrared protocol frame on a GPIO pin and starts a message of {address, command, extendedAddress, extendedCommand} for each one received.",
  options: {
    receiverPin: {
      type: "number",
      description: "The GPIO pin the infrared receiver's data line is on.",
      integer: true,
      min: 0,
    },
    activeLow: {
      type: "boolean",
      description:
        "Whether the receiver pulls its data line low (rather than high) to signal a mark.",
      default: true,
    },
    virtual: {
      type: "boolean",
      description: "Register without opening any GPIO pin.",
      default: false,
    },
  },
};
