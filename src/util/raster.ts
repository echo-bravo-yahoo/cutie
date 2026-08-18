import { readFile, stat } from "node:fs/promises";

import get from "lodash/get.js";
import { Jimp } from "jimp";

import { OptionSchema } from "./schema.js";
import { Message } from "./type-helpers.js";

export type RGB = [number, number, number];

// "contain" scales the source to fit inside the panel and fills what is left
// with the background. "cover" scales it to fill the panel and crops the
// overhang. "stretch" ignores the aspect ratio entirely.
export type Fit = "contain" | "cover" | "stretch";

// RGBA, row-major, four bytes per pixel.
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// How a display is told where its content comes from. Shared rather than
// written per display, because two displays reading the same config keys two
// different ways is how the drawing modes these replaced went wrong.
export interface SourceConfig {
  // "image" is a file jimp can decode. "bitmap" is raw pixels carried in the
  // message, in whatever form the panel documents.
  source: "image" | "bitmap";
  // A fixed path on the device. Only meaningful for "image", since a bitmap
  // arrives in the message by definition.
  file?: string;
  // lodash path to the value in the message. Omitted means the whole message is
  // the value.
  path?: string;
}

// The three source options read the same way on every display, so each one's
// schema spreads these rather than restating them.
export const SOURCE_OPTIONS: Record<string, OptionSchema> = {
  source: {
    type: "string",
    description:
      'Where the pixels come from: "image" is a file jimp can decode, "bitmap" is raw pixels carried in the message.',
    required: true,
    enum: ["image", "bitmap"],
  },
  file: {
    type: "string",
    description:
      'A fixed path on the device to draw. Only meaningful for "image"; a bitmap arrives in the message by definition.',
  },
  path: {
    type: "string",
    description:
      "Which value in the message holds the pixels. Omit to use the whole message.",
  },
};

export const FIT_OPTION: OptionSchema = {
  type: "string",
  description:
    "How a source larger or smaller than the panel is scaled onto it.",
  enum: ["contain", "cover", "stretch"],
};

// Rejects a configuration that cannot work, rather than letting it look
// plausible until a message arrives. Called from a display's constructor, so a
// bad config fails when it is registered.
export function validateSourceConfig(config: SourceConfig, name: string) {
  if (config.source !== "image" && config.source !== "bitmap") {
    throw new Error(
      `${name} needs a source of "image" or "bitmap", but got ${JSON.stringify(config.source)}.`,
    );
  }

  if (config.file !== undefined && config.path !== undefined) {
    throw new Error(
      `${name} takes either a file or a path, not both: a fixed path on the device, or somewhere in the message to read one from.`,
    );
  }

  if (config.file !== undefined && config.source === "bitmap") {
    throw new Error(
      `${name} reads a bitmap out of the message, so it takes a path rather than a file. Use "source": "image" to draw a file from disk.`,
    );
  }
}

export function sourceValueFor(
  config: SourceConfig,
  message: Message,
): unknown {
  if (config.file !== undefined) return config.file;
  return config.path !== undefined ? get(message, config.path) : message;
}

// jimp decodes an image in full before anything can resize it, so the peak cost
// of loading is four bytes per source pixel however small the panel is. This
// board has 427 MB of RAM and runs several other tasks, so a source above four
// megapixels - 16 MB once decoded - is refused rather than risking the host to
// whatever photo a config happens to point at.
const MAX_SOURCE_PIXELS = 4_000_000;

// Bounds the file before it is read, since the pixel count cannot be known
// until the header has been parsed. Generous next to the pixel cap: a
// photograph large enough to matter compresses well under this.
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

// Reads the dimensions out of an encoded image's header.
//
// Returns undefined for any format not listed here, TIFF among them. That is
// deliberate: guessing wrong would reject a legitimate image, and the byte cap
// still applies to whatever this cannot measure.
function imageSize(
  encoded: Buffer,
): { width: number; height: number } | undefined {
  if (
    encoded.length >= 24 &&
    encoded.readUInt32BE(0) === 0x89504e47 &&
    encoded.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return {
      width: encoded.readUInt32BE(16),
      height: encoded.readUInt32BE(20),
    };
  }

  if (encoded.length >= 10 && encoded.toString("latin1", 0, 3) === "GIF") {
    return { width: encoded.readUInt16LE(6), height: encoded.readUInt16LE(8) };
  }

  if (encoded.length >= 26 && encoded.toString("latin1", 0, 2) === "BM") {
    // A negative height means the rows are stored top-down; the magnitude is
    // still the height.
    return {
      width: Math.abs(encoded.readInt32LE(18)),
      height: Math.abs(encoded.readInt32LE(22)),
    };
  }

  if (encoded.length >= 4 && encoded.readUInt16BE(0) === 0xffd8) {
    // JPEG carries its dimensions in a start-of-frame segment, which sits after
    // an arbitrary number of other segments, so the marker chain has to be
    // walked to find it.
    let offset = 2;
    while (offset + 4 <= encoded.length) {
      if (encoded[offset] !== 0xff) return undefined;
      const marker = encoded[offset + 1];

      // Padding and the standalone markers carry no length field.
      if (marker === 0xff || marker === 0x01) {
        offset += 1;
        continue;
      }
      if (marker >= 0xd0 && marker <= 0xd8) {
        offset += 2;
        continue;
      }
      // Image data begins here, so any frame header has already been passed.
      if (marker === 0xda || marker === 0xd9) return undefined;

      // 0xc0-0xcf are start-of-frame except for these three, which reuse the
      // range for Huffman and arithmetic coding tables.
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame && offset + 9 <= encoded.length) {
        return {
          width: encoded.readUInt16BE(offset + 7),
          height: encoded.readUInt16BE(offset + 5),
        };
      }

      offset += 2 + encoded.readUInt16BE(offset + 2);
    }
  }

  return undefined;
}

export async function loadRaster(file: string): Promise<Raster> {
  const { size } = await stat(file);
  if (size > MAX_SOURCE_BYTES) {
    throw new Error(
      `${file} is ${size} bytes, above the ${MAX_SOURCE_BYTES} byte limit for a display source.`,
    );
  }

  const encoded = await readFile(file);
  const measured = imageSize(encoded);
  if (measured && measured.width * measured.height > MAX_SOURCE_PIXELS) {
    throw new Error(
      `${file} is ${measured.width}x${measured.height}, above the ${MAX_SOURCE_PIXELS} pixel limit for a display source.`,
    );
  }

  const { bitmap } = await Jimp.fromBuffer(encoded);
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: new Uint8ClampedArray(
      bitmap.data.buffer,
      bitmap.data.byteOffset,
      bitmap.data.byteLength,
    ),
  };
}

// Scales a raster onto a panel, resolving transparency against background on
// the way so the result is fully opaque.
//
// Compositing happens here rather than in the caller because it has to precede
// the scaling: averaging the colour of a transparent pixel with an opaque
// neighbour fringes the edges of anything cut out of its background. The panel
// chooses the background, which is why it is a parameter - white is paper on an
// e-ink panel, but on an LED matrix it means every letterboxed pixel at full
// brightness.
export function fitRaster(
  source: Raster,
  width: number,
  height: number,
  fit: Fit = "contain",
  background: RGB = [255, 255, 255],
): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = background[0];
    data[index * 4 + 1] = background[1];
    data[index * 4 + 2] = background[2];
    data[index * 4 + 3] = 255;
  }

  if (source.width === 0 || source.height === 0) return { width, height, data };

  // The region of the source that is drawn, and the region of the panel it is
  // drawn into. Only "contain" leaves part of the panel unpainted, and only
  // "cover" leaves part of the source undrawn.
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = source.width;
  let sourceHeight = source.height;
  let destX = 0;
  let destY = 0;
  let destWidth = width;
  let destHeight = height;

  if (fit === "contain") {
    const scale = Math.min(width / source.width, height / source.height);
    destWidth = Math.max(1, Math.round(source.width * scale));
    destHeight = Math.max(1, Math.round(source.height * scale));
    destX = Math.floor((width - destWidth) / 2);
    destY = Math.floor((height - destHeight) / 2);
  } else if (fit === "cover") {
    const scale = Math.max(width / source.width, height / source.height);
    sourceWidth = Math.max(
      1,
      Math.min(source.width, Math.round(width / scale)),
    );
    sourceHeight = Math.max(
      1,
      Math.min(source.height, Math.round(height / scale)),
    );
    sourceX = Math.floor((source.width - sourceWidth) / 2);
    sourceY = Math.floor((source.height - sourceHeight) / 2);
  }

  const xRatio = sourceWidth / destWidth;
  const yRatio = sourceHeight / destHeight;

  for (let y = 0; y < destHeight; y += 1) {
    // Each destination pixel averages the source pixels it covers, so that
    // shrinking a photograph to a few hundred pixels drops detail smoothly
    // rather than sampling one pixel in every hundred. Enlarging makes the
    // footprint smaller than a pixel, where this degenerates to nearest
    // neighbour - which is what a low-resolution panel wants anyway.
    const y0 = sourceY + y * yRatio;
    const y1 = Math.max(Math.floor(y0) + 1, Math.ceil(y0 + yRatio));

    for (let x = 0; x < destWidth; x += 1) {
      const x0 = sourceX + x * xRatio;
      const x1 = Math.max(Math.floor(x0) + 1, Math.ceil(x0 + xRatio));

      let red = 0;
      let green = 0;
      let blue = 0;
      let counted = 0;

      for (let sy = Math.floor(y0); sy < y1 && sy < source.height; sy += 1) {
        for (let sx = Math.floor(x0); sx < x1 && sx < source.width; sx += 1) {
          const at = (sy * source.width + sx) * 4;
          const alpha = source.data[at + 3] / 255;
          red += source.data[at] * alpha + background[0] * (1 - alpha);
          green += source.data[at + 1] * alpha + background[1] * (1 - alpha);
          blue += source.data[at + 2] * alpha + background[2] * (1 - alpha);
          counted += 1;
        }
      }

      if (counted === 0) continue;

      const at = ((destY + y) * width + destX + x) * 4;
      data[at] = red / counted;
      data[at + 1] = green / counted;
      data[at + 2] = blue / counted;
      data[at + 3] = 255;
    }
  }

  return { width, height, data };
}

// Accepts a bitmap as base64 or as an array of byte values, and insists it is
// exactly the size the panel expects. A short bitmap could be padded and a long
// one truncated, but either renders as a corrupted image, which is far harder
// to diagnose than being told the two lengths.
export function decodeBitmap(
  value: unknown,
  expectedBytes: number,
): Uint8Array {
  let bytes: Uint8Array;

  if (typeof value === "string") {
    bytes = new Uint8Array(Buffer.from(value, "base64"));
  } else if (Array.isArray(value)) {
    bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const byte = value[index];
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new Error(
          `A bitmap must hold whole numbers from 0 to 255, but index ${index} is ${JSON.stringify(byte)}.`,
        );
      }
      bytes[index] = byte;
    }
  } else {
    throw new Error(
      `A bitmap must be a base64 string or an array of numbers, but got ${typeof value}.`,
    );
  }

  if (bytes.length !== expectedBytes) {
    throw new Error(
      `This panel takes a bitmap of ${expectedBytes} bytes, but got ${bytes.length}.`,
    );
  }

  return bytes;
}

// Maps every pixel to the nearest entry in palette, returning one index per
// pixel. Alpha is ignored: fitRaster has already resolved it.
//
// Dithering trades a speckled texture for a much wider apparent range, which on
// a three-colour panel is the difference between a photograph and a poster.
export function quantize(
  raster: Raster,
  palette: Array<RGB>,
  dither = true,
): Uint8Array {
  const { width, height, data } = raster;
  const indices = new Uint8Array(width * height);

  // Error diffusion pushes fractional, sometimes negative, values into pixels
  // not yet visited, so it needs somewhere wider than a byte to accumulate.
  const working = dither ? new Float32Array(width * height * 3) : undefined;
  if (working) {
    for (let index = 0; index < width * height; index += 1) {
      working[index * 3] = data[index * 4];
      working[index * 3 + 1] = data[index * 4 + 1];
      working[index * 3 + 2] = data[index * 4 + 2];
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const red = working ? working[pixel * 3] : data[pixel * 4];
      const green = working ? working[pixel * 3 + 1] : data[pixel * 4 + 1];
      const blue = working ? working[pixel * 3 + 2] : data[pixel * 4 + 2];

      let nearest = 0;
      let shortest = Infinity;
      for (let entry = 0; entry < palette.length; entry += 1) {
        const [pr, pg, pb] = palette[entry];
        const distance =
          (red - pr) * (red - pr) +
          (green - pg) * (green - pg) +
          (blue - pb) * (blue - pb);
        if (distance < shortest) {
          shortest = distance;
          nearest = entry;
        }
      }
      indices[pixel] = nearest;

      if (!working) continue;

      // Floyd-Steinberg: the colour this pixel could not represent is spread
      // over its right, and the three below it, in sixteenths.
      const errors = [
        red - palette[nearest][0],
        green - palette[nearest][1],
        blue - palette[nearest][2],
      ];
      const spread = (atX: number, atY: number, weight: number) => {
        if (atX < 0 || atX >= width || atY >= height) return;
        const at = (atY * width + atX) * 3;
        working[at] += errors[0] * weight;
        working[at + 1] += errors[1] * weight;
        working[at + 2] += errors[2] * weight;
      };
      spread(x + 1, y, 7 / 16);
      spread(x - 1, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16);
      spread(x + 1, y + 1, 1 / 16);
    }
  }

  return indices;
}
