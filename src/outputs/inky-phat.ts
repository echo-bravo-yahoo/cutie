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
  // indices, WIDTH * HEIGHT long. "checkerboard" and "bands" ignore the message
  // and draw a fixed test pattern.
  mode?: "bar" | "pixels" | "checkerboard" | "bands";
  // Bands only: the palette indices to paint as equal vertical columns, left to
  // right. Defaults to one column per palette entry in index order, which makes
  // the drawn order a direct readout of whether indices map to the colours they
  // are supposed to - something no single-colour pattern can show.
  bands?: Array<number>;
  // Checkerboard only: the size of each square in pixels. At the panel's ~100
  // DPI a size of 1 resolves as a flat wash rather than a visible grid, which
  // still detects an addressing fault (it would show as stripes or banding) but
  // is harder to read by eye than a larger square.
  squareSize?: number;
  // lodash path to the number to display; the whole message when omitted.
  path?: string;
  min?: number;
  max?: number;
  color?: number;
  border?: number;
  // inkyphat refresh mode - "quick" is the fast, lower-fidelity waveform.
  refreshMode?: string;
  // The panel's third colour, which selects its drive voltages. There is no way
  // to tell the variants apart in software, so this is left unset by default
  // and the package's own (red-oriented) values apply unchanged.
  panelColor?: "black" | "red" | "yellow";
  spiDevice?: string;
  // Minimum gap between physical refreshes. Messages arriving sooner are
  // dropped rather than queued: the panel shows a current reading, so a stale
  // one waiting its turn has no value. Set 0 to refresh on every message.
  minRefreshMs?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Pimoroni's own driver picks the panel's source driving voltage from its
// colour, and sends a gate driving voltage as well. This package hardcodes one
// source voltage for every panel and never sends the gate voltage at all, so a
// yellow panel gets drive levels intended for a red one. No lookup table can
// compensate for that, which is why a yellow panel renders so dark it reads as
// black - a symptom reported widely enough to look like a hardware fault.
//
// Values are taken from pimoroni/inky, which selects them by panel colour.
const CMD_GATE_DRIVING_VOLTAGE = 0x03;
const CMD_SOURCE_DRIVING_VOLTAGE = 0x04;
const GATE_DRIVING_VOLTAGE = 0x17;
const SOURCE_DRIVING_VOLTAGE: Record<string, Array<number>> = {
  black: [0x41, 0xac, 0x32],
  red: [0x41, 0xac, 0x32],
  yellow: [0x07, 0xac, 0x32],
};

// Builds a drop-in replacement for the package's v2 renderer that corrects the
// drive voltages on their way to the panel.
//
// The constructor returns the real renderer with one method wrapped, rather
// than subclassing it: this project compiles to ES5, where a subclass becomes
// `_super.call(this, ...)` and calling a real class constructor that way
// throws. Returning an object from a constructor overrides `this`, so the
// controller still receives a genuine renderer.
async function patchedRendererFor(colour: string) {
  const RealRenderer = (await import("inkyphat/lib/inkyphat-renderer-v2.js"))
    .default as new (props: unknown) => {
    _sendCommand: (cmd: number, data?: unknown) => Promise<void>;
  };
  const source = SOURCE_DRIVING_VOLTAGE[colour];

  return function (props: unknown) {
    const renderer = new RealRenderer(props);
    const original = renderer._sendCommand.bind(renderer);

    renderer._sendCommand = async (cmd: number, data?: unknown) => {
      if (cmd !== CMD_SOURCE_DRIVING_VOLTAGE) return original(cmd, data);
      // Sent here rather than earlier because this package omits it entirely,
      // and immediately before the source voltage keeps the two in the order
      // the reference driver uses.
      await original(CMD_GATE_DRIVING_VOLTAGE, GATE_DRIVING_VOLTAGE);
      return original(cmd, source);
    };

    return renderer;
  } as unknown as new (props: unknown) => object;
}

let busyPollingPatched = false;

// inkyphat's BUSY-pin poller reads the pin, and if the panel is still busy
// sleeps for its poll interval before reading again. Several of its callers
// pass a timeout shorter than that interval's 500ms default - the reset path
// passes 200ms - so those calls get exactly one read and then reject if the
// panel happened to be busy at that instant. On a loaded single-core board
// whether the read lands before or after the panel releases the pin is a coin
// flip, and the rejection surfaces as an uncaught exception that terminates
// the process.
//
// Narrowing the interval fixes it without widening the timeouts, so a panel
// that really has hung still fails within the time its caller expects. It is
// done by patching the module rather than by forking the package because the
// renderers destructure pollPin at load time, and this runs before init()
// requires them.
async function patchBusyPolling() {
  if (busyPollingPatched) return;

  // The package is CommonJS, so the default export is the live module.exports
  // object - the very one the renderers will destructure from.
  const utils = (await import("inkyphat/lib/inkyphat-utils.js"))
    .default as Record<string, (...args: Array<unknown>) => unknown>;
  const original = utils.pollPin;

  utils.pollPin = (...args: Array<unknown>) => {
    const [pin, waitFor, timeout = 2000, interval = 500, onProgress] = args as [
      unknown,
      unknown,
      number,
      number,
      unknown,
    ];
    const polled = Math.max(10, Math.min(interval, Math.floor(timeout / 10)));
    return original(pin, waitFor, timeout, polled, onProgress);
  };

  busyPollingPatched = true;
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

  drawBands() {
    const bands = this.config.bands ?? [WHITE, BLACK, RED];
    const width = Math.floor(WIDTH / bands.length);

    this.panel.clearBuffer();
    bands.forEach((color, index) => {
      const startX = index * width;
      // The last band takes the remainder, so an unpainted sliver is never left
      // at the right edge when the width does not divide evenly.
      const endX = index === bands.length - 1 ? WIDTH : startX + width;
      // clearBuffer already leaves the panel white, so painting a white band
      // would be a no-op on top of a no-op.
      //
      // drawRect takes two half-open corners, not a position and a size. The
      // difference is invisible for a rectangle anchored at x=0 - which is why
      // drawBar above is correct either way - and silently relocates any
      // rectangle that is not.
      if (color !== WHITE) this.panel.drawRect(startX, 0, endX, HEIGHT, color);
    });
  }

  drawCheckerboard() {
    const size = Math.max(1, Math.floor(this.config.squareSize ?? 1));
    const color = this.config.color ?? BLACK;

    this.panel.clearBuffer();
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
          this.panel.setPixel(x, y, color);
        }
      }
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
      case "checkerboard":
        this.drawCheckerboard();
        break;
      case "bands":
        this.drawBands();
        break;
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
    try {
      await this.panel.redraw();
    } catch (error) {
      // One panel failing to draw must not terminate the host. This is a single
      // output among many, and every other step in the pipeline is unaffected
      // by it. The timestamp above still stands, so a panel that keeps failing
      // is retried on the normal schedule rather than on every message.
      this.error(`Refresh failed: ${error}`, { topic: this.logPrefix });
    }
    this.lastRefresh = Date.now();

    return message;
  }

  async enable() {
    await patchBusyPolling();

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

    // A factory rather than `class OffsetGpio extends Gpio`. This project
    // compiles to ES5, where TypeScript downlevels a subclass into
    // `_super.call(this, ...)` - and a real ES6 class constructor, which
    // onoff's Gpio is, throws "cannot be invoked without 'new'" when called
    // that way. Returning an object from a constructor overrides `this`, so
    // inkyphat's `new Gpio(...)` still gets a genuine Gpio.
    const OffsetGpio = function (pin: number, ...rest: Array<unknown>) {
      return new (Gpio as unknown as new (...args: Array<unknown>) => object)(
        pin + base,
        ...rest,
      );
    } as unknown as typeof Gpio;

    const inkyphatFactory = (await import("inkyphat")).default;
    const controllerFactory = (
      await import("inkyphat/lib/inkyphat-controller.js")
    ).default;

    const RendererV2 = this.config.panelColor
      ? await patchedRendererFor(this.config.panelColor)
      : undefined;

    this.panel = inkyphatFactory({
      mode: this.config.refreshMode ?? "quick",
      border: this.config.border ?? WHITE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ControllerFactory: (options: Record<string, any>) =>
        // A null RendererV2 is the package's own default, so leaving it unset
        // keeps the stock renderer rather than disabling anything.
        controllerFactory({ ...options, Gpio: OffsetGpio, RendererV2 }),
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
