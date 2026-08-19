import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { importOptional } from "../util/optional-dependency.js";
import { ModuleSchema } from "../util/schema.js";

export interface InfraredConfig extends TriggerConfig {
  receiverPin?: number;
  virtual?: boolean;
}

// pigpio ships no types and is an optional dependency.
/* eslint-disable @typescript-eslint/no-explicit-any */
type GpioPin = any;
type PigpioModule = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export default class Infrared extends Trigger {
  declare config: InfraredConfig;
  infraredReceiver?: GpioPin;

  constructor(config: InfraredConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async enable() {
    if (!this.config.virtual) {
      // the v3 code read `.pigpio` off the import() promise, so this was
      // always undefined even with the package installed
      const pigpio: PigpioModule = (
        await importOptional<{ default: PigpioModule }>(
          "pigpio",
          "trigger:infrared",
        )
      ).default;
      const Gpio = pigpio.Gpio;

      if (this.config.receiverPin) {
        this.infraredReceiver = new Gpio(this.config.receiverPin, {
          mode: Gpio.INPUT,
        });
        // each edge on the receiver becomes a message; decoding a protocol out
        // of the pulse train is a job for the step chain
        this.infraredReceiver.on("alert", (level: number, tick: number) => {
          this.fire(() => ({ level, tick }));
        });
        this.info(
          `Enabled infrared receiver on pin ${this.config.receiverPin}.`,
        );
      }
    }

    this.enabled = true;
  }

  async disable() {
    if (this.infraredReceiver) {
      this.infraredReceiver.removeAllListeners("alert");
      this.infraredReceiver = undefined;
      this.info("Disabled infrared receiver.");
    }

    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:infrared",
  description:
    "Starts a message of {level, tick} for every edge an infrared receiver sees. Decoding a protocol out of the pulse train is a job for the step chain.",
  options: {
    receiverPin: {
      type: "number",
      description: "The GPIO pin the infrared receiver's data line is on.",
      integer: true,
      min: 0,
    },
    virtual: {
      type: "boolean",
      description: "Register without opening any GPIO pin.",
      default: false,
    },
  },
};
