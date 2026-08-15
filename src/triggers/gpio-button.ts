import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { readGpioBase } from "../util/gpio.js";

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
}

const DEFAULT_DEBOUNCE_MS = 40;

// Buttons wired to GPIO, read through sysfs.
//
// Boards of this kind wire buttons active-low against a pull-up, so a pressed
// button reads 0. The pull-up is usually on the board; where it is not, the
// firmware can supply one via a `gpio=<pins>=ip,pu` line in config.txt, because
// sysfs GPIO offers no way to set internal bias.
export default class GpioButton extends Trigger {
  declare config: GpioButtonConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pins: Array<{ name: string; gpio: any }> = [];
  private lastEmit: Record<string, number> = {};

  constructor(config: GpioButtonConfig, task: Task) {
    super(config, task);

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
    // onoff writes the pin number straight to /sys/class/gpio/export with no
    // offset, so BCM numbers have to be shifted by the controller's base.
    const base = await readGpioBase();
    const { Gpio } = await import("onoff");

    for (const [name, bcm] of Object.entries(this.config.buttons ?? {})) {
      const gpio = new Gpio(bcm + base, "in", "both");

      gpio.watch((error: Error | null | undefined, value: number) => {
        if (error) {
          this.error(`Watch failed for button ${name}: ${error.message}`, {
            topic: this.logPrefix,
          });
          return;
        }

        const pressed = value === 0;
        if (!this.shouldEmit(name, pressed)) return;

        this.debug(`Button ${name} ${pressed ? "pressed" : "released"}.`, {
          topic: this.logPrefix,
        });
        this.startMessage({ button: name, pressed });
      });

      this.pins.push({ name, gpio });
    }

    this.info(
      `Enabled gpio buttons (${this.pins.map((p) => p.name).join(", ") || "none"}), gpio base ${base}.`,
      { topic: this.logPrefix },
    );
    this.enabled = true;
  }

  async disable() {
    for (const { gpio } of this.pins) {
      gpio.unwatchAll();
      gpio.unexport();
    }
    this.pins = [];
    this.info("Disabled gpio buttons.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:gpio-button",
  "disabled": false,
  "buttons": { "a": 5, "b": 6, "x": 16, "y": 24 },
  "emitOn": "press",
  "debounceMs": 40
}

Emits { button, pressed }. The pin numbers above are the four buttons on a
Unicorn HAT Mini; any active-low button wired to a GPIO works the same way.
*/
