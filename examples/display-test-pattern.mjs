#!/usr/bin/env node
//
// Write test patterns for a display output, as PNGs to draw with
// `"source": "image"`.
//
//   node examples/display-test-pattern.mjs --panel inky-phat --out /tmp
//
// Two patterns, because they catch different faults:
//
//   checkerboard  alternating squares. Any transposition or stride error in the
//                 addressing turns an even grid into stripes or a scatter, and
//                 a grid is obvious enough to read at a glance.
//   bands         one column per colour the panel can show, in a fixed order.
//                 The drawn order reads back whether the colours map to what
//                 they should - something no single-colour pattern can show,
//                 since it cannot tell "this colour works" from "this colour
//                 silently fell back to black".
//
// Options:
//   --panel <name>        inky-phat or unicorn-hat-mini (default inky-phat)
//   --panel-color <name>  the inky's third colour: yellow, red or black
//                         (default yellow). Match the output's panelColor, or
//                         the bands test what the file holds rather than what
//                         the panel does.
//   --width <n>           override the panel's width
//   --height <n>          override the panel's height
//   --square <n>          checkerboard square size in pixels
//   --out <dir>           where to write (default .)

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Jimp } from "jimp";

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];

const THIRD_COLOR = { yellow: YELLOW, red: RED, black: undefined };

const PANELS = {
  "inky-phat": {
    width: 212,
    height: 104,
    // Eight pixels rather than one: at this panel's ~100 DPI a single-pixel
    // check resolves as a flat wash, which still detects an addressing fault
    // but is much harder to read by eye than a visible grid.
    square: 8,
    // Filled in from --panel-color, since the palette's third entry is what
    // the bands are there to verify.
    bands: (third) => (third ? [WHITE, BLACK, third] : [WHITE, BLACK]),
  },
  "unicorn-hat-mini": {
    width: 17,
    height: 7,
    square: 1,
    // Full-brightness primaries, so a swapped channel shows up as the columns
    // arriving in the wrong order rather than as a subtly wrong shade.
    bands: () => [RED, GREEN, BLUE, WHITE],
  },
};

function parseArgs(argv) {
  const options = {
    panel: "inky-phat",
    panelColor: "yellow",
    out: ".",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inlineValue] = argv[index].split("=");
    const value = inlineValue ?? argv[++index];

    switch (flag) {
      case "--panel":
        options.panel = value;
        break;
      case "--panel-color":
        options.panelColor = value;
        break;
      case "--width":
        options.width = Number(value);
        break;
      case "--height":
        options.height = Number(value);
        break;
      case "--square":
        options.square = Number(value);
        break;
      case "--out":
        options.out = value;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option ${flag}. Try --help.`);
    }
  }

  return options;
}

function usage() {
  console.log(
    `Write display test patterns as PNGs.

  node examples/display-test-pattern.mjs [options]

  --panel <name>        ${Object.keys(PANELS).join(" or ")} (default inky-phat)
  --panel-color <name>  the inky's third colour: ${Object.keys(THIRD_COLOR).join(", ")} (default yellow)
  --width <n>           override the panel's width
  --height <n>          override the panel's height
  --square <n>          checkerboard square size in pixels
  --out <dir>           where to write (default .)`,
  );
}

function blankImage(width, height) {
  return new Jimp({ width, height, color: 0x000000ff });
}

function setPixel(image, x, y, [red, green, blue]) {
  const at = (y * image.bitmap.width + x) * 4;
  image.bitmap.data[at] = red;
  image.bitmap.data[at + 1] = green;
  image.bitmap.data[at + 2] = blue;
  image.bitmap.data[at + 3] = 255;
}

function checkerboard(width, height, square, [on, off]) {
  const image = blankImage(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lit =
        (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0 ? on : off;
      setPixel(image, x, y, lit);
    }
  }

  return image;
}

function bands(width, height, colors) {
  const image = blankImage(width, height);
  const bandWidth = Math.floor(width / colors.length);

  for (let x = 0; x < width; x += 1) {
    // The last band takes the remainder, so an unpainted sliver is never left
    // at the right edge when the width does not divide evenly.
    const index = Math.min(colors.length - 1, Math.floor(x / bandWidth));
    for (let y = 0; y < height; y += 1) setPixel(image, x, y, colors[index]);
  }

  return image;
}

async function writePng(image, path) {
  await writeFile(path, await image.getBuffer("image/png"));
  console.log(`${path} (${image.bitmap.width}x${image.bitmap.height})`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  usage();
  process.exit(0);
}

const panel = PANELS[options.panel];
if (!panel) {
  console.error(
    `Unknown panel ${options.panel}. Known panels: ${Object.keys(PANELS).join(", ")}.`,
  );
  process.exit(2);
}

if (!(options.panelColor in THIRD_COLOR)) {
  console.error(
    `Unknown panel colour ${options.panelColor}. Known colours: ${Object.keys(THIRD_COLOR).join(", ")}.`,
  );
  process.exit(2);
}

const width = options.width ?? panel.width;
const height = options.height ?? panel.height;
const square = options.square ?? panel.square;
const palette = panel.bands(THIRD_COLOR[options.panelColor]);

await writePng(
  // Black and white on both panels: the checkerboard is testing where pixels
  // land, and the panels have no colour in common beyond these two.
  checkerboard(width, height, square, [WHITE, BLACK]),
  join(options.out, `${options.panel}-checkerboard.png`),
);
await writePng(
  bands(width, height, palette),
  join(options.out, `${options.panel}-bands.png`),
);
