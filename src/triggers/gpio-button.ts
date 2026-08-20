import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { ModuleSchema } from "../util/schema.js";
import {
  getPigpioConnection,
  PigpioClientGpio,
} from "../util/pigpio-client.js";

export interface GpioButtonConfig extends TriggerConfig {
  // BCM pin numbers keyed by the name each button reports as.
  buttons: Record<string, number>;
  // Which transitions emit a message. Buttons are wired active-low, so a press
  // is the falling edge.
  emitOn?: "press" | "release" | "both";
  // Ignore repeat transitions on the same button within this window. Mechanical
  // buttons bounce for a few milliseconds and would otherwise emit several
  // messages per physical press.
  debounceMs?: number;
  // Watch no pins at all, so a config naming buttons loads on a machine with no
  // GPIO. Nothing can then press them, so the task never fires.
  virtual?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 40;

// Buttons wired to GPIO, read through pigpiod.
//
// Boards of this kind wire buttons active-low against a pull-up, so a pressed
// button reads 0. The pull-up is usually on the board; where it is not, the
// firmware can supply one via a `gpio=<pins>=ip,pu` line in config.txt --
// pigpio-client can set internal bias itself (pullUpDown), but this trigger
// doesn't call it, so an unbiased pin still needs the firmware-level pull-up.
export default class GpioButton extends Trigger {
  declare config: GpioButtonConfig;
  private pins: Array<{ name: string; gpio: PigpioClientGpio }> = [];
  private lastEmit: Record<string, number> = {};

  constructor(config: GpioButtonConfig, task: Task, index?: number) {
    super(config, task, index);

    this.name = "gpio-button";
  }

  private shouldEmit(name: string, pressed: boolean) {
    const emitOn = this.config.emitOn ?? "press";
    if (emitOn === "press" && !pressed) return false;
    if (emitOn === "release" && pressed) return false;

    const debounce = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const now = Date.now();
    if (now - (this.lastEmit[name] ?? 0) < debounce) return false;
    this.lastEmit[name] = now;
    return true;
  }

  async enable() {
    if (this.config.virtual) {
      this.info("Enabled gpio buttons (virtual); no pins are watched.");
      this.enabled = true;
      return;
    }

    const pigpioClient = await getPigpioConnection("trigger:gpio-button");

    for (const [name, bcm] of Object.entries(this.config.buttons ?? {})) {
      const gpio = pigpioClient.gpio(bcm);
      gpio.modeSet("input");
      // pigpio-client calls back once with (null, null) after endNotify() --
      // ignore it.
      gpio.notify((level, tick) => {
        if (level === null || tick === null) return;

        const pressed = level === 0;
        if (!this.shouldEmit(name, pressed)) return;

        this.debug(`Button ${name} ${pressed ? "pressed" : "released"}.`);
        this.fire(() => ({ button: name, pressed }));
      });

      this.pins.push({ name, gpio });
    }

    this.info(
      `Enabled gpio buttons (${this.pins.map((p) => p.name).join(", ") || "none"}).`,
    );
    this.enabled = true;
  }

  async disable() {
    for (const { gpio } of this.pins) gpio.endNotify();
    this.pins = [];
    this.info("Disabled gpio buttons.");
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:gpio-button",
  "disabled": false,
  "buttons": { "a": 5, "b": 6, "x": 16, "y": 24 },
  "emitOn": "press",
  "debounceMs": 40,
  "virtual": false
}

Emits { button, pressed }. The pin numbers above are the four buttons on a
Unicorn HAT Mini; any active-low button wired to a GPIO works the same way.
*/

export const schema: ModuleSchema = {
  type: "trigger:gpio-button",
  description:
    "Starts a message of {button, pressed} whenever an active-low button wired to a GPIO pin changes.",
  options: {
    buttons: {
      type: "object",
      description:
        'The buttons to watch, as a name to BCM pin number map, such as {"a": 5, "b": 6}. The name is what the message reports.',
      required: true,
    },
    emitOn: {
      type: "string",
      description: "Which edge starts a message.",
      default: "press",
      enum: ["press", "release", "both"],
    },
    debounceMs: {
      type: "number",
      description:
        "How long to ignore further edges after one is taken. A button bounces for a few milliseconds and would otherwise emit several messages per press.",
      default: DEFAULT_DEBOUNCE_MS,
      unit: "ms",
      min: 0,
    },
    virtual: {
      type: "boolean",
      description:
        "Register without watching any pin, so a config naming buttons loads on a machine with no GPIO.",
      default: false,
    },
  },
};
