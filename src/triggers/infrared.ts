import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { importOptional } from "../util/optional-dependency.js";

export interface InfraredConfig extends TriggerConfig {
  ledPin?: number;
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
  infraredLed?: GpioPin;
  infraredReceiver?: GpioPin;

  constructor(config: InfraredConfig, task: Task) {
    super(config, task);
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

      if (this.config.ledPin) {
        this.infraredLed = new Gpio(this.config.ledPin, { mode: Gpio.OUTPUT });
        this.info(`Enabled infrared LED on pin ${this.config.ledPin}.`, {
          topic: this.logPrefix,
        });
      }

      if (this.config.receiverPin) {
        this.infraredReceiver = new Gpio(this.config.receiverPin, {
          mode: Gpio.INPUT,
        });
        // each edge on the receiver becomes a message; decoding a protocol out
        // of the pulse train is a job for the step chain
        this.infraredReceiver.on("alert", (level: number, tick: number) => {
          this.startMessage({ level, tick });
        });
        this.info(
          `Enabled infrared receiver on pin ${this.config.receiverPin}.`,
          { topic: this.logPrefix },
        );
      }
    }

    this.enabled = true;
  }

  async disable() {
    if (this.infraredLed) {
      this.infraredLed = undefined;
      this.info("Disabled infrared LED.", { topic: this.logPrefix });
    }

    if (this.infraredReceiver) {
      this.infraredReceiver.removeAllListeners("alert");
      this.infraredReceiver = undefined;
      this.info("Disabled infrared receiver.", { topic: this.logPrefix });
    }

    this.enabled = false;
  }
}

/*
{
  "type": "trigger:infrared",
  "disabled": false,
  "virtual": false,
  "ledPin": 23,
  "receiverPin": 24
}
*/
