import { createRequire } from "node:module";
import get from "lodash/get.js";

import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export type RGB = [number, number, number];

// The panel is two HT16D35A chips on the SPI0 hardware chip selects, so they
// map one-to-one onto the kernel's two spidev nodes.
const DEFAULT_SPI_DEVICES = ["/dev/spidev0.0", "/dev/spidev0.1"];

export interface UnicornHatMiniConfig extends OutputConfig {
  // "gauge" fills columns left to right in proportion to where the value sits
  // between min and max. "all" floods the panel with one interpolated colour.
  // "pixels" takes the message itself as a row-major array of [r, g, b].
  mode?: "gauge" | "all" | "pixels";
  // lodash path to the number to display; the whole message when omitted.
  path?: string;
  min?: number;
  max?: number;
  brightness?: number;
  lowColor?: RGB;
  highColor?: RGB;
  offColor?: RGB;
  // One spidev node per HT16D35A chip, in chip-select order.
  spiDevices?: Array<string>;
}

const ROWS = 7;
const COLS = 17;

const DEFAULT_LOW: RGB = [0, 0, 255];
const DEFAULT_HIGH: RGB = [255, 0, 0];
const DEFAULT_OFF: RGB = [0, 0, 0];

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
// table is still borrowed from the package, since it is data rather than logic.
class UnicornPanel {
  private spis: Array<{
    write: (b: Buffer, cb: (e: Error | null) => void) => void;
  }> = [];
  private buffer = new Array(CHIP_BYTES * 2).fill(0);
  // Pixel index -> the three buffer offsets holding its red, green and blue.
  private lut: Array<[number, number, number]>;

  constructor(
    private devices: Array<string>,
    private brightness: number,
  ) {
    const require = createRequire(import.meta.url);
    this.lut = require("unicorn-hat-mini/src/lut");
  }

  private send(chip: number, bytes: Array<number>): Promise<void> {
    return new Promise((resolve, reject) =>
      this.spis[chip].write(Buffer.from(bytes), (err) =>
        err ? reject(err) : resolve(),
      ),
    );
  }

  async open() {
    const require = createRequire(import.meta.url);
    const SPI = require("pi-spi");

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

  setPixel(row: number, col: number, [r, g, b]: RGB) {
    const index = row * COLS + col;
    if (index < 0 || index >= ROWS * COLS) return;
    const [ir, ig, ib] = this.lut[index];
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

function interpolate(low: RGB, high: RGB, fraction: number): RGB {
  const at = (index: number) =>
    Math.round(low[index] + (high[index] - low[index]) * fraction);
  return [at(0), at(1), at(2)];
}

export default class UnicornHatMini extends Output {
  declare config: UnicornHatMiniConfig;
  panel?: UnicornPanel;

  constructor(config: UnicornHatMiniConfig, task: Task) {
    super(config, task);

    this.name = "unicorn-hat-mini";
  }

  get low(): RGB {
    return this.config.lowColor ?? DEFAULT_LOW;
  }

  get high(): RGB {
    return this.config.highColor ?? DEFAULT_HIGH;
  }

  get off(): RGB {
    return this.config.offColor ?? DEFAULT_OFF;
  }

  // Where the value sits between min and max, as 0..1.
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
        `unicorn-hat-mini expected a number${
          this.config.path ? ` at path "${this.config.path}"` : ""
        } but got ${JSON.stringify(raw)}.`,
      );
    }
    return value;
  }

  drawGauge(panel: UnicornPanel, value: number) {
    const fraction = this.fraction(value);
    const lit = Math.round(fraction * COLS);
    const color = interpolate(this.low, this.high, fraction);

    for (let col = 0; col < COLS; col++) {
      const colour = col < lit ? color : this.off;
      for (let row = 0; row < ROWS; row++) {
        panel.setPixel(row, col, colour);
      }
    }
  }

  drawAll(panel: UnicornPanel, value: number) {
    panel.setAll(interpolate(this.low, this.high, this.fraction(value)));
  }

  drawPixels(panel: UnicornPanel, message: Message) {
    if (!Array.isArray(message)) {
      throw new Error(
        `unicorn-hat-mini "pixels" mode expects an array of [r, g, b] triples.`,
      );
    }

    for (let index = 0; index < ROWS * COLS; index++) {
      const pixel = (message[index] as RGB | undefined) ?? this.off;
      panel.setPixel(Math.floor(index / COLS), index % COLS, pixel);
    }
  }

  async send(message: Message) {
    // Narrowed to a local so the draw helpers need no non-null assertions.
    const panel = this.panel;
    if (!this.enabled || !panel) return message;

    switch (this.config.mode ?? "gauge") {
      case "gauge":
        this.drawGauge(panel, this.numberFrom(message));
        break;
      case "all":
        this.drawAll(panel, this.numberFrom(message));
        break;
      case "pixels":
        this.drawPixels(panel, message);
        break;
    }

    await panel.show();
    return message;
  }

  async enable() {
    // Constructed lazily, per the convention every hardware-backed step
    // follows: it pulls in a compiled binding, and a host without the HAT must
    // still be able to load the rest of the config.
    this.panel = new UnicornPanel(
      this.config.spiDevices ?? DEFAULT_SPI_DEVICES,
      this.config.brightness ?? 0.2,
    );
    await this.panel.open();

    this.panel.setAll(this.off);
    await this.panel.show();

    this.info("Enabled unicorn hat mini.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    if (this.panel) {
      this.panel.setAll(this.off);
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
  "mode": "gauge",
  "path": "temp",
  "min": 15,
  "max": 30,
  "brightness": 0.2
}

Needs root. The unicorn-hat-mini driver initializes node-rpio with
`gpiomem: false`, which maps /dev/mem rather than /dev/gpiomem, and that is
root-only regardless of the gpio group. cutie.service runs as User=pi, so this
output does nothing useful until that is addressed deliberately.
*/
