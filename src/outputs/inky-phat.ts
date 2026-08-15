import get from "lodash/get.js";

import Output, { OutputConfig } from "../util/Output.js";
import { readGpioBase } from "../util/gpio.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

// inkyphat's palette indices, from its lib/inkyphat-utils.js.
//
// Index 2 drives whichever third colour the panel has. The pHAT ships in
// black/white/red and black/white/yellow variants, and there is no way to tell
// them apart in software. YELLOW and RED are the same index deliberately, so
// config can name whichever colour the hardware actually shows.
export const WHITE = 0;
export const BLACK = 1;
export const RED = 2;
export const YELLOW = 2;
export const LIGHT_RED = 3;

// E-ink panels wear with each refresh, and a tri-colour refresh is the harshest
// - it drives the panel for ten seconds or so. Pimoroni advise against
// refreshing these more often than every few minutes. A sensor task reporting
// every 30s would otherwise refresh 120 times an hour, degrading the panel and
// blocking the pipeline for a third of its life.
const DEFAULT_MIN_REFRESH_MS = 180_000;

const WIDTH = 212;
const HEIGHT = 104;

export interface InkyPhatConfig extends OutputConfig {
  // "bar" fills a horizontal bar in proportion to where the value sits between
  // min and max. "pixels" takes the message as a row-major array of palette
  // indices, WIDTH * HEIGHT long.
  mode?: "bar" | "pixels";
  // lodash path to the number to display; the whole message when omitted.
  path?: string;
  min?: number;
  max?: number;
  color?: number;
  border?: number;
  // inkyphat refresh mode - "quick" is the fast, lower-fidelity waveform.
  refreshMode?: string;
  spiDevice?: string;
  // Minimum gap between physical refreshes. Messages arriving sooner are
  // dropped rather than queued: the panel shows a current reading, so a stale
  // one waiting its turn has no value. Set 0 to refresh on every message.
  minRefreshMs?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default class InkyPhat extends Output {
  declare config: InkyPhatConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  panel?: any;
  lastRefresh = 0;

  constructor(config: InkyPhatConfig, task: Task) {
    super(config, task);

    this.name = "inky-phat";
  }

  fraction(value: number) {
    const min = this.config.min ?? 0;
    const max = this.config.max ?? 100;
    if (max === min) return 0;
    return clamp((value - min) / (max - min), 0, 1);
  }

  numberFrom(message: Message): number {
    const raw = this.config.path ? get(message, this.config.path) : message;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(
        `inky-phat expected a number${
          this.config.path ? ` at path "${this.config.path}"` : ""
        } but got ${JSON.stringify(raw)}.`,
      );
    }
    return value;
  }

  drawBar(value: number) {
    const filled = Math.round(this.fraction(value) * WIDTH);
    const color = this.config.color ?? BLACK;

    this.panel.clearBuffer();
    if (filled > 0) {
      this.panel.drawRect(0, 0, filled, HEIGHT, color);
    }
  }

  drawPixels(message: Message) {
    if (!Array.isArray(message)) {
      throw new Error(
        `inky-phat "pixels" mode expects a row-major array of palette indices.`,
      );
    }

    this.panel.clearBuffer();
    for (let index = 0; index < WIDTH * HEIGHT; index++) {
      const color = message[index];
      if (typeof color !== "number" || color === WHITE) continue;
      this.panel.setPixel(index % WIDTH, Math.floor(index / WIDTH), color);
    }
  }

  async send(message: Message) {
    if (!this.enabled) return message;

    const minGap = this.config.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS;
    const since = Date.now() - this.lastRefresh;
    if (minGap > 0 && this.lastRefresh > 0 && since < minGap) {
      this.debug(
        `Skipping refresh; ${Math.round((minGap - since) / 1000)}s until the panel may be redrawn again.`,
        { topic: this.logPrefix },
      );
      return message;
    }

    switch (this.config.mode ?? "bar") {
      case "bar":
        this.drawBar(this.numberFrom(message));
        break;
      case "pixels":
        this.drawPixels(message);
        break;
    }

    // E-ink refresh takes seconds, so this deliberately awaits rather than
    // firing and forgetting: overlapping redraws corrupt the panel. Stamped
    // before the await as well as after, so a refresh still in flight when the
    // next message lands is treated as recent rather than as never-happened.
    this.lastRefresh = Date.now();
    await this.panel.redraw();
    this.lastRefresh = Date.now();

    return message;
  }

  async enable() {
    const base = await readGpioBase();

    // inkyphat hardcodes BCM pin numbers (RESET 27, BUSY 17, DC 22) and hands
    // them straight to onoff, which writes them to /sys/class/gpio/export with
    // no offset applied. On this kernel that export fails, so the pin numbers
    // are shifted by the chip base on the way through.
    //
    // The shift goes in via inkyphat's own dependency injection rather than by
    // patching onoff's module exports: its controller factory takes Gpio as an
    // option, and its top-level factory takes the controller factory.
    const { Gpio } = await import("onoff");
    class OffsetGpio extends Gpio {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(pin: number, ...rest: Array<any>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        super(pin + base, ...(rest as [any]));
      }
    }

    const inkyphatFactory = (await import("inkyphat")).default;
    const controllerFactory = (
      await import("inkyphat/lib/inkyphat-controller.js")
    ).default;

    this.panel = inkyphatFactory({
      mode: this.config.refreshMode ?? "quick",
      border: this.config.border ?? WHITE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ControllerFactory: (options: Record<string, any>) =>
        controllerFactory({ ...options, Gpio: OffsetGpio }),
    });

    await this.panel.init(
      this.config.spiDevice ? { spiDevice: this.config.spiDevice } : {},
    );

    this.info(`Enabled inky phat (gpio base ${base}).`, {
      topic: this.logPrefix,
    });
    this.enabled = true;
  }

  async disable() {
    if (this.panel) await this.panel.destroy();
    this.info("Disabled inky phat.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "output:inky-phat",
  "disabled": false,
  "mode": "bar",
  "path": "temp",
  "min": 15,
  "max": 30,
  "color": 1,
  "refreshMode": "quick"
}

Shares SPI0 CE0 with the Unicorn HAT Mini's first chip when both are stacked,
so each controller receives the other's traffic. In practice each ignores
commands that do not match its own protocol, and both keep working - but that
is a property of these two controllers rather than anything guaranteed, and it
has only been observed with the two driven one after the other, not at once.
*/
