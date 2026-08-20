import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { NECFrameDecoder } from "../util/bitbang/adapters/nec.js";
import {
  getPigpioConnection,
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
      this.receiver.notify((level, tick) => {
        if (level === null || tick === null) return;
        const command = this.decoder!.consumeEdge(level, tick);
        if (command) this.fire(() => command);
      });

      this.info(`Enabled NEC receiver on pin ${this.config.receiverPin}.`);
    }

    this.enabled = true;
  }

  async disable() {
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
