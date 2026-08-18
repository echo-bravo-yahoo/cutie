#!/usr/bin/env node
//
// Render a line of text to a PNG, for a display output to draw with
// `"source": "image"`.
//
//   node examples/render-text-image.mjs "68F" /var/lib/cutie/enviro-temp.png --width 160 --height 80
//
// Not a cutie module: cutie's own display outputs only know how to draw a
// pre-made image, so text is baked into one here, outside the pipeline, and
// consumed through the ordinary `source: "image"` path via transform:shell.
//
// Options:
//   --width <n>       canvas width in pixels (default 160)
//   --height <n>      canvas height in pixels (default 80)
//   --font-size <n>   8, 10, 12, 14, 16, 32, 64 or 128 (default 64) - a fixed
//                      bitmap size, not a scalable one, so pick the nearest.
//                      10, 12 and 14 exist only in black.
//   --color <name>    "white" or "black" ink (default white)
//   --background <r,g,b>  canvas fill behind the text (default 0,0,0)

import { writeFile } from "node:fs/promises";

import { Jimp, loadFont, HorizontalAlign, VerticalAlign } from "jimp";
import {
  SANS_8_BLACK,
  SANS_10_BLACK,
  SANS_12_BLACK,
  SANS_14_BLACK,
  SANS_16_BLACK,
  SANS_32_BLACK,
  SANS_64_BLACK,
  SANS_128_BLACK,
  SANS_8_WHITE,
  SANS_16_WHITE,
  SANS_32_WHITE,
  SANS_64_WHITE,
  SANS_128_WHITE,
} from "@jimp/plugin-print/fonts";

// The bundled Open Sans set: fixed bitmap sizes, and white skips a few sizes
// black has, per @jimp/plugin-print's own font list.
const FONTS = {
  black: {
    8: SANS_8_BLACK,
    10: SANS_10_BLACK,
    12: SANS_12_BLACK,
    14: SANS_14_BLACK,
    16: SANS_16_BLACK,
    32: SANS_32_BLACK,
    64: SANS_64_BLACK,
    128: SANS_128_BLACK,
  },
  white: {
    8: SANS_8_WHITE,
    16: SANS_16_WHITE,
    32: SANS_32_WHITE,
    64: SANS_64_WHITE,
    128: SANS_128_WHITE,
  },
};

function parseArgs(argv) {
  const options = {
    width: 160,
    height: 80,
    fontSize: 64,
    color: "white",
    background: [0, 0, 0],
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [flag, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[++index];

    switch (flag) {
      case "--width":
        options.width = Number(value);
        break;
      case "--height":
        options.height = Number(value);
        break;
      case "--font-size":
        options.fontSize = Number(value);
        break;
      case "--color":
        options.color = value;
        break;
      case "--background":
        options.background = value.split(",").map(Number);
        break;
      default:
        throw new Error(`Unknown option ${flag}. Try --help.`);
    }
  }

  [options.text, options.outputPath] = positional;
  return options;
}

function usage() {
  console.log(
    `Render a line of text to a PNG.

  node examples/render-text-image.mjs "<text>" <outputPath> [options]

  --width <n>            canvas width in pixels (default 160)
  --height <n>            canvas height in pixels (default 80)
  --font-size <n>         ${Object.keys(FONTS.black).join(", ")} (default 64)
  --color <name>          ${Object.keys(FONTS).join(" or ")} (default white)
  --background <r,g,b>    canvas fill behind the text (default 0,0,0)`,
  );
}

function rgbToHex([red, green, blue]) {
  return (((red << 24) | (green << 16) | (blue << 8) | 0xff) >>> 0) >>> 0;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  usage();
  process.exit(0);
}

if (!options.text || !options.outputPath) {
  console.error("Both <text> and <outputPath> are required. Try --help.");
  process.exit(2);
}

const sizesForColor = FONTS[options.color];
if (!sizesForColor) {
  console.error(
    `Unknown color ${options.color}. Known colors: ${Object.keys(FONTS).join(", ")}.`,
  );
  process.exit(2);
}

const fontPath = sizesForColor[options.fontSize];
if (!fontPath) {
  console.error(
    `No ${options.color} font at size ${options.fontSize}. Available sizes for ${options.color}: ${Object.keys(sizesForColor).join(", ")}.`,
  );
  process.exit(2);
}

const font = await loadFont(fontPath);
const image = new Jimp({
  width: options.width,
  height: options.height,
  color: rgbToHex(options.background),
});

image.print({
  font,
  x: 0,
  y: 0,
  text: {
    text: options.text,
    alignmentX: HorizontalAlign.CENTER,
    alignmentY: VerticalAlign.MIDDLE,
  },
  maxWidth: options.width,
  maxHeight: options.height,
});

await writeFile(options.outputPath, await image.getBuffer("image/png"));
console.log(`${options.outputPath} (${options.width}x${options.height})`);
