import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import {
  getPigpioConnection,
  PigpioClientGpio,
} from "../util/pigpio-client.js";
import { ModuleSchema } from "../util/schema.js";

export interface InfraredConfig extends TriggerConfig {
  receiverPin?: number;
  virtual?: boolean;
}

export default class Infrared extends Trigger {
  declare config: InfraredConfig;
  infraredReceiver?: PigpioClientGpio;

  constructor(config: InfraredConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async enable() {
    if (!this.config.virtual) {
      const pigpioClient = await getPigpioConnection("trigger:infrared");

      if (this.config.receiverPin) {
        this.infraredReceiver = pigpioClient.gpio(this.config.receiverPin);
        this.infraredReceiver.modeSet("input");
        // pigpio-client calls back once with (null, null) after endNotify()
        // -- ignore it.
        this.infraredReceiver.notify((level, tick) => {
          if (level === null || tick === null) return;
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
      this.infraredReceiver.endNotify();
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
