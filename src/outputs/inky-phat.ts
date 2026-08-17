import Output, { OutputConfig } from "../util/Output.js";
import { readGpioBase } from "../util/gpio.js";
import {
  decodeBitmap,
  fitRaster,
  loadRaster,
  quantize,
  sourceValueFor,
  validateSourceConfig,
  Fit,
  RGB,
  SourceConfig,
} from "../util/raster.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";

// Type-only, so it is erased before runtime and the package is still reached
// through importOptional below.
import type { Gpio as OnoffGpio } from "onoff";

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

// What the panel shows for each palette index, as close as RGB gets. Quantising
// picks the nearest of these, so the array's order is the panel's index order
// and the third entry has to match the hardware: a photograph reduced against
// red on a yellow panel picks the wrong pixels, not merely the wrong shade.
const PALETTE_WHITE: RGB = [255, 255, 255];
const PALETTE_BLACK: RGB = [0, 0, 0];
const PALETTE_THIRD: Record<string, RGB | undefined> = {
  black: undefined,
  red: [255, 0, 0],
  yellow: [255, 255, 0],
};

export interface InkyPhatConfig extends OutputConfig, SourceConfig {
  // How a source larger or smaller than the panel is scaled onto it.
  fit?: Fit;
  // Whether an image is dithered when reduced to the panel's colours. Worth
  // turning off for line art and text, where a speckled texture is noise rather
  // than shading.
  dither?: boolean;
  border?: number;
  // inkyphat refresh mode - "quick" is the fast, lower-fidelity waveform.
  refreshMode?: string;
  // The panel's third colour. It selects the drive voltages and the colour an
  // image is quantised against. There is no way to tell the variants apart in
  // software, so this is left unset by default and the package's own
  // (red-oriented) values apply unchanged.
  panelColor?: "black" | "red" | "yellow";
  spiDevice?: string;
  // Minimum gap between physical refreshes. Messages arriving sooner are
  // dropped rather than queued: the panel shows a current reading, so a stale
  // one waiting its turn has no value. Set 0 to refresh on every message.
  minRefreshMs?: number;
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
    validateSourceConfig(config, this.name);
  }

  // The colours an image is reduced to, in palette-index order. A panel with no
  // third colour quantises to two, which is what its hardware can show.
  get palette(): Array<RGB> {
    const third = this.config.panelColor
      ? PALETTE_THIRD[this.config.panelColor]
      : PALETTE_THIRD.red;

    return third
      ? [PALETTE_WHITE, PALETTE_BLACK, third]
      : [PALETTE_WHITE, PALETTE_BLACK];
  }

  // One palette index per pixel, row-major.
  async indicesFrom(message: Message): Promise<Uint8Array> {
    const value = sourceValueFor(this.config, message);

    if (this.config.source === "bitmap") {
      const bitmap = decodeBitmap(value, WIDTH * HEIGHT);
      const stray = bitmap.findIndex((index) => index > LIGHT_RED);
      if (stray !== -1) {
        throw new Error(
          `This panel has ${LIGHT_RED + 1} palette entries, but the bitmap holds ${bitmap[stray]} at index ${stray}.`,
        );
      }
      return bitmap;
    }

    if (typeof value !== "string") {
      throw new Error(
        `inky-phat expected a path to an image file but got ${JSON.stringify(value)}.`,
      );
    }

    // Letterboxed against white, which is the panel's unwritten state and so
    // the only background that costs no ink.
    const fitted = fitRaster(
      await loadRaster(value),
      WIDTH,
      HEIGHT,
      this.config.fit,
      PALETTE_WHITE,
    );
    return quantize(fitted, this.palette, this.config.dither ?? true);
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

    // Read before the buffer is touched, so a source that turns out to be
    // unreadable leaves the panel showing its last good image.
    const indices = await this.indicesFrom(message);

    this.panel.clearBuffer();
    for (let index = 0; index < indices.length; index += 1) {
      // clearBuffer already leaves every pixel white.
      if (indices[index] === WHITE) continue;
      this.panel.setPixel(
        index % WIDTH,
        Math.floor(index / WIDTH),
        indices[index],
      );
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
    // Establishes the package is present, and names the step if it is not. The
    // three subpath imports below are inside this same package, so they need no
    // separate guard. Cheap: inkyphat's index requires only its utils module,
    // and its ControllerFactory default parameter never fires because one is
    // always passed. It has to precede patchBusyPolling(), which the renderers
    // destructure pollPin from at load time.
    await importOptional<object>("inkyphat", "output:inky-phat");
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
    const { Gpio } = await importOptional<{ Gpio: typeof OnoffGpio }>(
      "onoff",
      "output:inky-phat",
    );

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
  "source": "image",
  "file": "/var/lib/cutie/frame.png",
  "panelColor": "yellow",
  "refreshMode": "quick"
}

The panel draws pixels and nothing else. Anything that produces an image or a
bitmap can feed it - transform:shell and transform:javascript both can - so a
reading is rendered by whatever step precedes this one:

{
  "type": "output:inky-phat",
  "source": "bitmap",
  "path": "frame",
  "panelColor": "yellow"
}

212x104 pixels, one byte per pixel, holding a palette index: 0 white, 1 black,
2 the panel's third colour, 3 light red. As base64 or an array of numbers.

Shares SPI0 CE0 with the Unicorn HAT Mini's first chip when both are stacked,
so each controller receives the other's traffic. In practice each ignores
commands that do not match its own protocol, and both keep working - but that
is a property of these two controllers rather than anything guaranteed.
*/
