import Output, { OutputConfig } from "../util/Output.js";
import { readGpioBase } from "../util/gpio.js";
import {
  decodeBitmap,
  fitRaster,
  loadRaster,
  sourceValueFor,
  validateSourceConfig,
  Fit,
  RGB,
  Raster,
  SourceConfig,
  SOURCE_OPTIONS,
  FIT_OPTION,
} from "../util/raster.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { ModuleSchema } from "../util/schema.js";

// Type-only, so it is erased before runtime and the package is still reached
// through importOptional below.
import type { Gpio as OnoffGpio } from "onoff";

export type { RGB };

export type Rotation = 0 | 90 | 180 | 270;

// The controller's own fixed memory, regardless of the panel glued to it. A
// smaller panel is centred inside this by an offset - see offsetsFor() below.
const CONTROLLER_COLS = 132;
const CONTROLLER_ROWS = 162;

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 160;
const DEFAULT_SPI_SPEED_HZ = 10_000_000;
const DEFAULT_CHUNK_BYTES = 4096;

// An unlit pixel, which is what a letterboxed pixel has to be: this panel
// emits light rather than reflecting it, matching the Unicorn HAT Mini's own
// choice for the same reason.
const BACKGROUND: RGB = [0, 0, 0];

// ST7735 command opcodes, per the datasheet and Pimoroni's reference driver
// (pimoroni/st7735-python).
const CMD_SWRESET = 0x01;
const CMD_SLPOUT = 0x11;
const CMD_NORON = 0x13;
const CMD_INVON = 0x21;
const CMD_DISPOFF = 0x28;
const CMD_DISPON = 0x29;
const CMD_CASET = 0x2a;
const CMD_RASET = 0x2b;
const CMD_RAMWR = 0x2c;
const CMD_MADCTL = 0x36;
const CMD_COLMOD = 0x3a;
const CMD_FRMCTR1 = 0xb1;
const CMD_FRMCTR2 = 0xb2;
const CMD_FRMCTR3 = 0xb3;
const CMD_INVCTR = 0xb4;
const CMD_PWCTR1 = 0xc0;
const CMD_PWCTR2 = 0xc1;
const CMD_PWCTR4 = 0xc3;
const CMD_PWCTR5 = 0xc4;
const CMD_VMCTR1 = 0xc5;
const CMD_GMCTRP1 = 0xe0;
const CMD_GMCTRN1 = 0xe1;

export interface ST7735Config extends OutputConfig, SourceConfig {
  // How a source larger or smaller than the panel is scaled onto it.
  fit?: Fit;
  width?: number;
  height?: number;
  rotation?: Rotation;
  // Controller memory offset. Wiring, not a chip property - see offsetsFor().
  offsetLeft?: number;
  offsetTop?: number;
  // Wiring rather than chip properties, so these have no sane module-level
  // default and config must supply them.
  spiDevice: string;
  dcPin: number;
  backlightPin: number;
  spiSpeedHz?: number;
  // Do everything but drive the panel: the source is still loaded, scaled and
  // length-checked, and what would have been drawn is logged. Lets a display
  // config be developed on a machine with no panel attached.
  virtual?: boolean;
}

// pi-spi ships no types, so only the members used here are named, matching
// output:unicorn-hat-mini's own local interfaces for the same package.
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

export function color565(r: number, g: number, b: number): number {
  return (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)) & 0xffff;
}

// The controller's column address (CASET) always maps to the panel's memory
// width and its row address (RASET) to its memory height, regardless of how
// the image drawn onto it is rotated - only the offsets and the shape of the
// pixel data sent change with rotation. See offsetsFor() and rotateRaster().
function memoryDimensions(width: number, height: number, rotation: Rotation) {
  return rotation === 90 || rotation === 270
    ? { memoryWidth: height, memoryHeight: width }
    : { memoryWidth: width, memoryHeight: height };
}

// Centres the panel inside the controller's fixed memory. Pimoroni's own
// reference driver's default formula, applied to the memory-space dimensions
// rather than the configured width/height directly - a rotated landscape
// panel's *memory* width is its configured height, and vice versa, so using
// the unrotated width/height here would compute a negative, nonsensical
// offset for any panel wired in landscape.
function offsetsFor(
  memoryWidth: number,
  memoryHeight: number,
  configured: { offsetLeft?: number; offsetTop?: number },
) {
  return {
    offsetLeft:
      configured.offsetLeft ?? Math.floor((CONTROLLER_COLS - memoryWidth) / 2),
    offsetTop:
      configured.offsetTop ?? Math.floor((CONTROLLER_ROWS - memoryHeight) / 2),
  };
}

// Rotates a raster to match what the controller's fixed CASET/RASET scan
// order expects, matching pimoroni/st7735-python's own image_to_data(), which
// rotates the source image via numpy's rot90 (counterclockwise) before
// flattening it into the wire format.
export function rotateRaster(raster: Raster, rotation: Rotation): Raster {
  if (rotation === 0) return raster;

  const { width, height, data } = raster;
  const { memoryWidth: rotatedWidth, memoryHeight: rotatedHeight } =
    memoryDimensions(width, height, rotation);
  const rotated = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      let toX: number;
      let toY: number;

      if (rotation === 90) {
        toX = y;
        toY = width - 1 - x;
      } else if (rotation === 270) {
        toX = height - 1 - y;
        toY = x;
      } else {
        toX = width - 1 - x;
        toY = height - 1 - y;
      }

      const to = (toY * rotatedWidth + toX) * 4;
      rotated[to] = data[from];
      rotated[to + 1] = data[from + 1];
      rotated[to + 2] = data[from + 2];
      rotated[to + 3] = data[from + 3];
    }
  }

  return { width: rotatedWidth, height: rotatedHeight, data: rotated };
}

export interface ST7735PanelOptions {
  spiDevice: string;
  dcPin: number;
  backlightPin: number;
  width: number;
  height: number;
  rotation: Rotation;
  offsetLeft?: number;
  offsetTop?: number;
  spiSpeedHz: number;
}

// Hand-rolled driver for the ST7735, over pi-spi (SPI, clock-speed-aware) and
// onoff (DC/backlight GPIO, offset-aware via readGpioBase()) - the same
// toolkit output:unicorn-hat-mini already uses for a hand-rolled protocol
// driver. Exported so a test can assert color565()'s conversion and
// rotateRaster()'s remapping directly.
export class ST7735Panel {
  private spi?: SpiHandle;
  private dc?: OnoffGpio;
  private backlight?: OnoffGpio;
  private readonly memoryWidth: number;
  private readonly memoryHeight: number;
  private readonly offsetLeft: number;
  private readonly offsetTop: number;

  constructor(private options: ST7735PanelOptions) {
    const { memoryWidth, memoryHeight } = memoryDimensions(
      options.width,
      options.height,
      options.rotation,
    );
    this.memoryWidth = memoryWidth;
    this.memoryHeight = memoryHeight;
    ({ offsetLeft: this.offsetLeft, offsetTop: this.offsetTop } = offsetsFor(
      memoryWidth,
      memoryHeight,
      options,
    ));
  }

  private transfer(bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) =>
      this.spi!.write(bytes, (err) => (err ? reject(err) : resolve())),
    );
  }

  private async command(cmd: number, data: Array<number> = []) {
    this.dc!.writeSync(0);
    await this.transfer(Buffer.from([cmd]));
    if (data.length) {
      this.dc!.writeSync(1);
      await this.transfer(Buffer.from(data));
    }
  }

  private async setWindow() {
    const { offsetLeft, offsetTop, memoryWidth, memoryHeight } = this;
    await this.command(CMD_CASET, [
      0x00,
      offsetLeft,
      0x00,
      memoryWidth + offsetLeft - 1,
    ]);
    await this.command(CMD_RASET, [
      0x00,
      offsetTop,
      0x00,
      memoryHeight + offsetTop - 1,
    ]);
    await this.command(CMD_RAMWR);
  }

  private async writePixels(bytes: Buffer) {
    this.dc!.writeSync(1);
    for (let offset = 0; offset < bytes.length; offset += DEFAULT_CHUNK_BYTES) {
      await this.transfer(bytes.subarray(offset, offset + DEFAULT_CHUNK_BYTES));
    }
  }

  // Every byte below is a fixed chip-tuning constant, copied verbatim from
  // pimoroni/st7735-python's own _init() rather than hand-derived.
  private async init() {
    await this.command(CMD_SWRESET);
    await sleep(150);
    await this.command(CMD_SLPOUT);
    await sleep(500);

    await this.command(CMD_FRMCTR1, [0x01, 0x2c, 0x2d]);
    await this.command(CMD_FRMCTR2, [0x01, 0x2c, 0x2d]);
    await this.command(CMD_FRMCTR3, [0x01, 0x2c, 0x2d, 0x01, 0x2c, 0x2d]);
    await this.command(CMD_INVCTR, [0x07]);

    await this.command(CMD_PWCTR1, [0xa2, 0x02, 0x84]);
    await this.command(CMD_PWCTR2, [0x0a, 0x00]);
    await this.command(CMD_PWCTR4, [0x8a, 0x2a]);
    await this.command(CMD_PWCTR5, [0x8a, 0xee]);
    await this.command(CMD_VMCTR1, [0x0e]);

    await this.command(CMD_INVON);
    // BGR order - see the "MADCTL" note in this module's config docs if
    // colours come out swapped on the real panel.
    await this.command(CMD_MADCTL, [0xc8]);
    await this.command(CMD_COLMOD, [0x05]);

    await this.setWindow();

    await this.command(
      CMD_GMCTRP1,
      [
        0x02, 0x1c, 0x07, 0x12, 0x37, 0x32, 0x29, 0x2d, 0x29, 0x25, 0x2b, 0x39,
        0x00, 0x01, 0x03, 0x10,
      ],
    );
    await this.command(
      CMD_GMCTRN1,
      [
        0x03, 0x1d, 0x07, 0x06, 0x2e, 0x2c, 0x29, 0x2d, 0x2e, 0x2e, 0x37, 0x3f,
        0x00, 0x00, 0x02, 0x10,
      ],
    );

    await this.command(CMD_NORON);
    await sleep(10);
    await this.command(CMD_DISPON);
    await sleep(100);
  }

  async open() {
    const SPI = (
      await importOptional<{ default: SpiModule }>("pi-spi", "output:st7735")
    ).default;
    this.spi = SPI.initialize(this.options.spiDevice);
    this.spi.clockSpeed(this.options.spiSpeedHz);
    this.spi.dataMode(0);
    this.spi.bitOrder(SPI.order.MSB_FIRST);

    const { Gpio } = await importOptional<{ Gpio: typeof OnoffGpio }>(
      "onoff",
      "output:st7735",
    );
    const base = await readGpioBase();

    // A factory rather than `class OffsetGpio extends Gpio`, matching
    // output:inky-phat's own OffsetGpio: this project compiles to ES5, where
    // a subclass becomes `_super.call(this, ...)`, and calling a real ES6
    // class constructor that way throws.
    const OffsetGpio = function (pin: number, ...rest: Array<unknown>) {
      return new (Gpio as unknown as new (...args: Array<unknown>) => object)(
        pin + base,
        ...rest,
      );
    } as unknown as typeof Gpio;

    this.dc = new OffsetGpio(this.options.dcPin, "out");
    this.backlight = new OffsetGpio(this.options.backlightPin, "out");

    await this.init();
    this.backlight.writeSync(1);
  }

  async show(raster: Raster) {
    const rotated = rotateRaster(raster, this.options.rotation);
    const pixels = Buffer.alloc(rotated.width * rotated.height * 2);

    for (let index = 0; index < rotated.width * rotated.height; index += 1) {
      const at = index * 4;
      const color = color565(
        rotated.data[at],
        rotated.data[at + 1],
        rotated.data[at + 2],
      );
      pixels.writeUInt16BE(color, index * 2);
    }

    await this.setWindow();
    await this.writePixels(pixels);
  }

  async close() {
    if (this.spi && this.dc) await this.command(CMD_DISPOFF);

    if (this.backlight) {
      this.backlight.writeSync(0);
      this.backlight.unexport();
      this.backlight = undefined;
    }
    if (this.dc) {
      this.dc.unexport();
      this.dc = undefined;
    }
    this.spi = undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countLitPixels(raster: Raster) {
  let lit = 0;
  for (let index = 0; index < raster.width * raster.height; index += 1) {
    const at = index * 4;
    if (raster.data[at] || raster.data[at + 1] || raster.data[at + 2]) {
      lit += 1;
    }
  }
  return lit;
}

export default class ST7735 extends Output {
  declare config: ST7735Config;
  panel?: ST7735Panel;

  constructor(config: ST7735Config, task: Task) {
    super(config, task);

    this.name = "st7735";
    validateSourceConfig(this.config, this.name);
  }

  // The wiring pins are required only when a panel is actually driven, which
  // is a pairing no single option's schema can express.
  async register() {
    if (this.config.virtual) return;

    for (const pin of ["spiDevice", "dcPin", "backlightPin"] as const) {
      if (this.config[pin] === undefined)
        throw new Error(
          `"output:st7735" needs a "${pin}" naming the panel's wiring, or "virtual": true.`,
        );
    }
  }

  async rasterFrom(message: Message): Promise<Raster> {
    const value = sourceValueFor(this.config, message);
    const width = this.config.width as number;
    const height = this.config.height as number;

    if (this.config.source === "bitmap") {
      const bytes = decodeBitmap(value, width * height * 3);
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < width * height; index += 1) {
        data[index * 4] = bytes[index * 3];
        data[index * 4 + 1] = bytes[index * 3 + 1];
        data[index * 4 + 2] = bytes[index * 3 + 2];
        data[index * 4 + 3] = 255;
      }
      return { width, height, data };
    }

    if (typeof value !== "string") {
      throw new Error(
        `st7735 expected a path to an image file but got ${JSON.stringify(value)}.`,
      );
    }

    return fitRaster(
      await loadRaster(value),
      width,
      height,
      this.config.fit,
      BACKGROUND,
    );
  }

  async send(message: Message, traceId: string) {
    const panel = this.panel;
    if (!this.enabled) return message;
    if (!panel && !this.config.virtual) return message;

    // Read before the buffer is touched, so a source that turns out to be
    // unreadable leaves the panel showing its last good image.
    const raster = await this.rasterFrom(message);

    if (!panel) {
      this.info(
        `Would draw (virtual): ${this.config.width}x${this.config.height}, ${countLitPixels(raster)} lit pixels.`,
        { traceId },
      );
      return message;
    }

    try {
      await panel.show(raster);
    } catch (error) {
      // One panel failing to draw must not terminate the host - this is a
      // single output among many, matching output:inky-phat's own guard on
      // its hardware write.
      this.error(`Draw failed: ${error}`, { traceId });
    }

    return message;
  }

  async enable() {
    if (!this.config.virtual) {
      this.panel = new ST7735Panel({
        spiDevice: this.config.spiDevice,
        dcPin: this.config.dcPin,
        backlightPin: this.config.backlightPin,
        width: this.config.width as number,
        height: this.config.height as number,
        rotation: this.config.rotation as Rotation,
        offsetLeft: this.config.offsetLeft,
        offsetTop: this.config.offsetTop,
        spiSpeedHz: this.config.spiSpeedHz as number,
      });
      await this.panel.open();
    }

    this.info("Enabled st7735.");
    this.enabled = true;
  }

  async disable() {
    if (this.panel) {
      await this.panel.close();
      this.panel = undefined;
    }
    this.info("Disabled st7735.");
    this.enabled = false;
  }
}

/*
{
  "type": "output:st7735",
  "disabled": false,
  "virtual": false,
  "source": "image",
  "file": "/var/lib/cutie/frame.png",
  "width": 160,
  "height": 80,
  "rotation": 270,
  "spiDevice": "/dev/spidev0.1",
  "dcPin": 9,
  "backlightPin": 12
}

The panel draws pixels and nothing else. Anything that produces an image or a
bitmap can feed it - transform:shell and transform:javascript both can - so a
reading is rendered by whatever step precedes this one.

width/height are the panel as it should appear once rotated - what the source
image is fit against - not the controller's fixed internal memory shape. The
controller addresses a fixed 132x162 regardless of the panel glued to it, and
rotation is applied entirely by transposing the pixel buffer before it is
sent, not by any chip-level rotation register - the MADCTL byte above is fixed
regardless of "rotation".

spiDevice, dcPin and backlightPin are wiring, not chip properties, so they
have no sane module-level default; config must supply them unless "virtual"
is set. If colours come out swapped on the real panel, flip the MADCTL byte
in this module's init sequence between 0xC8 (BGR) and 0xC0 (RGB).

With "virtual": true the panel is never opened, but the source is still
loaded, scaled and length-checked, and each message logs how many pixels
would be lit.
*/

export const schema: ModuleSchema = {
  type: "output:st7735",
  description:
    "Draws each message on an ST7735 panel. The pixels come from an image file or from a bitmap the message carries.",
  options: {
    ...SOURCE_OPTIONS,
    fit: FIT_OPTION,
    width: {
      type: "number",
      description:
        "The panel's width as it should appear once rotated, in pixels.",
      default: DEFAULT_WIDTH,
      min: 1,
      integer: true,
    },
    height: {
      type: "number",
      description:
        "The panel's height as it should appear once rotated, in pixels.",
      default: DEFAULT_HEIGHT,
      min: 1,
      integer: true,
    },
    rotation: {
      type: "number",
      description:
        "Degrees to rotate the source before it is drawn: 0, 90, 180, or 270.",
      default: 0,
      min: 0,
      max: 270,
      integer: true,
    },
    offsetLeft: {
      type: "number",
      description:
        "Controller memory column offset. Wiring, not a chip property; left unset, the panel is centred automatically.",
      integer: true,
    },
    offsetTop: {
      type: "number",
      description:
        "Controller memory row offset. Wiring, not a chip property; left unset, the panel is centred automatically.",
      integer: true,
    },
    spiDevice: {
      type: "string",
      description:
        "The spidev node the panel is on. Required unless virtual is set.",
    },
    dcPin: {
      type: "number",
      description:
        "The GPIO pin the panel's data/command line is wired to. Required unless virtual is set.",
      integer: true,
      min: 0,
    },
    backlightPin: {
      type: "number",
      description:
        "The GPIO pin the panel's backlight is wired to. Required unless virtual is set.",
      integer: true,
      min: 0,
    },
    spiSpeedHz: {
      type: "number",
      description: "The SPI clock speed to drive the panel at.",
      default: DEFAULT_SPI_SPEED_HZ,
      unit: "Hz",
      min: 1,
      integer: true,
    },
    virtual: {
      type: "boolean",
      description:
        "Do everything but drive the panel: the source is still loaded, scaled and length-checked, and each message logs how many pixels would be lit.",
      default: false,
    },
  },
};
