import Output, { OutputConfig } from "../util/Output.js";
import { importOptional } from "../util/optional-dependency.js";
import { PIXEL_LUT } from "./unicorn-hat-mini-lut.js";
import {
  decodeBitmap,
  fitRaster,
  loadRaster,
  sourceValueFor,
  validateSourceConfig,
  Fit,
  RGB,
  SourceConfig,
} from "../util/raster.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export type { RGB };

// The panel is two HT16D35A chips on the SPI0 hardware chip selects, so they
// map one-to-one onto the kernel's two spidev nodes.
const DEFAULT_SPI_DEVICES = ["/dev/spidev0.0", "/dev/spidev0.1"];
const DEFAULT_BRIGHTNESS = 0.2;

export interface UnicornHatMiniConfig extends OutputConfig, SourceConfig {
  // How a source larger or smaller than the panel is scaled onto it.
  fit?: Fit;
  brightness?: number;
  // One spidev node per HT16D35A chip, in chip-select order.
  spiDevices?: Array<string>;
  // Do everything but drive the panel: the source is still loaded, scaled and
  // length-checked, and what would have been drawn is logged. Lets a display
  // config be developed on a machine with no HAT attached.
  virtual?: boolean;
}

const ROWS = 7;
const COLS = 17;

// An unlit LED, which is what a letterboxed pixel has to be: this panel emits
// light rather than reflecting it, so filling the margins with white would ring
// the image in seven full-brightness LEDs.
const BACKGROUND: RGB = [0, 0, 0];

// HT16D35A commands, per the reference driver.
const CMD_SOFT_RESET = 0xcc;
const CMD_GLOBAL_BRIGHTNESS = 0x37;
const CMD_COM_PIN_CTRL = 0x41;
const CMD_ROW_PIN_CTRL = 0x42;
const CMD_WRITE_DISPLAY = 0x80;
const CMD_SYSTEM_CTRL = 0x35;
const CMD_SCROLL_CTRL = 0x20;

// Bytes of display RAM per chip; the second chip's frame starts this far into
// the combined buffer.
const CHIP_BYTES = 28 * 8;

// pi-spi ships no types, so only the members used here are named.
interface SpiHandle {
  write: (bytes: Buffer, done: (error: Error | null) => void) => void;
  clockSpeed: (hz: number) => void;
  dataMode: (mode: number) => void;
  bitOrder: (order: number) => void;
}

interface SpiModule {
  initialize: (device: string) => SpiHandle;
  order: { MSB_FIRST: number };
}

// Minimal driver for the two HT16D35A chips, over spidev.
//
// This replaces the unicorn-hat-mini package, which cannot be used as shipped:
// it drives SPI through node-rpio started with `gpiomem: false`, which maps
// /dev/mem and therefore demands root for a panel the kernel already exposes
// safely. It also has `this.opts = { ...DEFAULT_OPTIONS, options }` - the
// spread on `options` is missing - so every caller option is silently dropped,
// leaving brightness pinned, buttons forced on, and SIGINT/SIGTERM handlers
// installed that call process.exit() out from under a long-running service.
//
// Transfers go through pi-spi rather than a plain write() because a bare write
// to spidev runs at the device tree's spi-max-frequency, 125 MHz on this
// platform, which the HT16D35A cannot latch - the panel stays dark with no
// error anywhere. pi-spi sets the speed on each transfer. Only the pixel lookup
// table survives from the package, vendored into unicorn-hat-mini-lut.ts since
// it is data rather than logic.
//
// Exported so a test can assert the buffer mapping directly: getting a pixel to
// the right three offsets is the part of this file most worth pinning down, and
// nothing but the panel knows where they are.
export class UnicornPanel {
  private spis: Array<SpiHandle> = [];
  private buffer = new Array(CHIP_BYTES * 2).fill(0);
  // Pixel index -> the three buffer offsets holding its red, green and blue.
  private lut = PIXEL_LUT;

  constructor(
    private devices: Array<string> = DEFAULT_SPI_DEVICES,
    private brightness: number = DEFAULT_BRIGHTNESS,
  ) {}

  private send(chip: number, bytes: Array<number>): Promise<void> {
    return new Promise((resolve, reject) =>
      this.spis[chip].write(Buffer.from(bytes), (err) =>
        err ? reject(err) : resolve(),
      ),
    );
  }

  async open() {
    // pi-spi's CommonJS module.exports arrives as the namespace's default.
    const SPI = (
      await importOptional<{ default: SpiModule }>(
        "pi-spi",
        "output:unicorn-hat-mini",
      )
    ).default;

    this.spis = this.devices.map((device) => {
      const spi = SPI.initialize(device);
      spi.clockSpeed(1_000_000);
      spi.dataMode(0);
      spi.bitOrder(SPI.order.MSB_FIRST);
      return spi;
    });

    const level = Math.round(clamp(this.brightness, 0, 1) * 0x3f);
    for (let chip = 0; chip < this.spis.length; chip += 1) {
      await this.send(chip, [CMD_SOFT_RESET]);
      await this.send(chip, [CMD_GLOBAL_BRIGHTNESS, level]);
      await this.send(chip, [CMD_SCROLL_CTRL, 0x00]);
      await this.send(chip, [CMD_SYSTEM_CTRL, 0x00]);
      await this.send(chip, [CMD_COM_PIN_CTRL, 0xff]);
      await this.send(chip, [CMD_ROW_PIN_CTRL, 0xff, 0xff, 0xff, 0xff]);
      await this.send(chip, [CMD_SYSTEM_CTRL, 0x03]);
    }
  }

  // The lookup table is column-major: entries for one column are contiguous, so
  // the stride is ROWS rather than COLS. Two checks confirm it against the
  // alternative - under this reading each row's buffer offsets step evenly,
  // and the boundary between the two chips' address ranges falls between two
  // columns (nine on the first, eight on the second) rather than partway
  // through a row, which is the only split a physical panel could be wired to.
  //
  // The package's own setPixel names its parameters (row, col) but strides by
  // ROWS, so those names describe (x, y). Transposing here instead keeps
  // (row, col) meaning what it says everywhere else in this file.
  setPixel(row: number, col: number, [r, g, b]: RGB) {
    // Both coordinates are bounded rather than the index they combine into: a
    // row of ROWS folds into the next column's first pixel, which is a real
    // entry in the table and would be silently overwritten.
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    const [ir, ig, ib] = this.lut[col * ROWS + row];
    this.buffer[ir] = r;
    this.buffer[ig] = g;
    this.buffer[ib] = b;
  }

  setAll(colour: RGB) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) this.setPixel(row, col, colour);
    }
  }

  async show() {
    for (let chip = 0; chip < this.spis.length; chip += 1) {
      const start = chip * CHIP_BYTES;
      await this.send(chip, [
        CMD_WRITE_DISPLAY,
        0x00,
        ...this.buffer.slice(start, start + CHIP_BYTES),
      ]);
    }
  }

  async close() {
    for (let chip = 0; chip < this.spis.length; chip += 1) {
      await this.send(chip, [CMD_SYSTEM_CTRL, 0x00]);
    }
    this.spis = [];
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// A pixel counts as lit if any channel is. The panel is dark by default, so
// this is the one number that says whether an image would show at all.
function countLitPixels(pixels: Uint8Array) {
  let lit = 0;
  for (let index = 0; index < ROWS * COLS; index += 1) {
    if (pixels[index * 3] || pixels[index * 3 + 1] || pixels[index * 3 + 2]) {
      lit += 1;
    }
  }
  return lit;
}

export default class UnicornHatMini extends Output {
  declare config: UnicornHatMiniConfig;
  panel?: UnicornPanel;

  constructor(config: UnicornHatMiniConfig, task: Task) {
    super(config, task);

    this.name = "unicorn-hat-mini";
    validateSourceConfig(this.config, this.name);
  }

  addDefaultsToConfig(config: UnicornHatMiniConfig): UnicornHatMiniConfig {
    return {
      fit: "contain",
      brightness: DEFAULT_BRIGHTNESS,
      spiDevices: DEFAULT_SPI_DEVICES,
      virtual: false,
      ...config,
    };
  }

  // Three bytes per pixel, row-major: red, green, blue.
  async pixelsFrom(message: Message): Promise<Uint8Array> {
    const value = sourceValueFor(this.config, message);

    if (this.config.source === "bitmap") {
      return decodeBitmap(value, ROWS * COLS * 3);
    }

    if (typeof value !== "string") {
      throw new Error(
        `unicorn-hat-mini expected a path to an image file but got ${JSON.stringify(value)}.`,
      );
    }

    const fitted = fitRaster(
      await loadRaster(value),
      COLS,
      ROWS,
      this.config.fit,
      BACKGROUND,
    );

    // Dropping alpha rather than converting: fitRaster has already resolved it
    // against the background, so every pixel is opaque.
    const pixels = new Uint8Array(ROWS * COLS * 3);
    for (let index = 0; index < ROWS * COLS; index += 1) {
      pixels[index * 3] = fitted.data[index * 4];
      pixels[index * 3 + 1] = fitted.data[index * 4 + 1];
      pixels[index * 3 + 2] = fitted.data[index * 4 + 2];
    }
    return pixels;
  }

  async send(message: Message, traceId: string) {
    // Narrowed to a local so the draw below needs no non-null assertions. A
    // virtual instance has no panel and returns before reaching that draw.
    const panel = this.panel;
    if (!this.enabled) return message;
    if (!panel && !this.config.virtual) return message;

    // Read before the buffer is touched, so a source that turns out to be
    // unreadable leaves the panel showing its last good image.
    const pixels = await this.pixelsFrom(message);

    if (!panel) {
      this.info(
        `Would draw (virtual): ${COLS}x${ROWS}, ${countLitPixels(pixels)} lit pixels.`,
        { topic: this.logPrefix, traceId },
      );
      return message;
    }

    for (let index = 0; index < ROWS * COLS; index += 1) {
      panel.setPixel(Math.floor(index / COLS), index % COLS, [
        pixels[index * 3],
        pixels[index * 3 + 1],
        pixels[index * 3 + 2],
      ]);
    }

    await panel.show();
    return message;
  }

  async enable() {
    if (!this.config.virtual) {
      // Constructed lazily, per the convention every hardware-backed step
      // follows: it pulls in a compiled binding, and a host without the HAT
      // must still be able to load the rest of the config.
      this.panel = new UnicornPanel(
        this.config.spiDevices,
        this.config.brightness,
      );
      await this.panel.open();

      this.panel.setAll(BACKGROUND);
      await this.panel.show();
    }

    this.info("Enabled unicorn hat mini.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    if (this.panel) {
      this.panel.setAll(BACKGROUND);
      await this.panel.show();
      await this.panel.close();
      this.panel = undefined;
    }
    this.info("Disabled unicorn hat mini.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "output:unicorn-hat-mini",
  "disabled": false,
  "virtual": false,
  "source": "image",
  "file": "/var/lib/cutie/frame.png",
  "brightness": 0.2
}

The panel draws pixels and nothing else. Anything that produces an image or a
bitmap can feed it - transform:shell and transform:javascript both can - so a
reading is rendered by whatever step precedes this one:

{
  "type": "output:unicorn-hat-mini",
  "source": "bitmap",
  "path": "frame",
  "brightness": 0.2
}

17x7 pixels, three bytes per pixel, holding red, green and blue. As base64 or
an array of numbers.

Runs unprivileged. Every transfer goes through spidev, which the kernel already
exposes to the spi group, so no /dev/mem mapping and no root are involved.

With "virtual": true the panel is never opened, but the source is still loaded,
scaled and length-checked, and each message logs how many pixels would be lit.
*/
