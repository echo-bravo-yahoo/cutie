import {
  Jimp,
  loadFont,
  measureText,
  measureTextHeight,
  HorizontalAlign,
  VerticalAlign,
} from "jimp";
import {
  SANS_8_WHITE,
  SANS_16_WHITE,
  SANS_32_WHITE,
  SANS_64_WHITE,
  SANS_128_WHITE,
} from "@jimp/plugin-print/fonts";

import Transform, { Context, WholeMessageConfig } from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface RenderTextConfig extends WholeMessageConfig {
  text: string;
  fontSize: number;
  width: number;
  height: number;
}

type Font = Awaited<ReturnType<typeof loadFont>>;

// The bundled Open Sans set is bitmap fonts at fixed sizes, and white skips a
// few sizes that black has.
const FONT_PATHS: Record<number, string> = {
  8: SANS_8_WHITE,
  16: SANS_16_WHITE,
  32: SANS_32_WHITE,
  64: SANS_64_WHITE,
  128: SANS_128_WHITE,
};

// Both caches are module-level so they outlive a config reload and are shared
// by every step that uses this module.
const fonts = new Map<number, Promise<Font>>();

// A decoded font costs seconds on a single slow core, so the promise is kept
// and every caller of one size awaits the same load.
export function loadWhiteFont(fontSize: number): Promise<Font> {
  let font = fonts.get(fontSize);

  if (!font) {
    font = loadFont(FONT_PATHS[fontSize]);
    fonts.set(fontSize, font);
    // A failed load is not kept, so the next enable retries it.
    font.catch(() => fonts.delete(fontSize));
  }

  return font;
}

const FRAME_CACHE_LIMIT = 32;

// Keyed by every input that affects the picture, so a hit cannot be stale. A
// node shows a handful of distinct readings a day, so almost every redraw hits.
export const frameCache = new Map<string, string>();

// Returns width x height x 3 bytes of RGB, row-major from the top left, as
// base64. A string, because an object message would be structuredClone'd on
// its way between steps.
export async function renderText(
  text: string,
  fontSize: number,
  width: number,
  height: number,
): Promise<string> {
  const key = JSON.stringify([text, fontSize, width, height]);
  const cached = frameCache.get(key);
  if (cached !== undefined) return cached;

  const font = await loadWhiteFont(fontSize);

  // print() draws "?" for a character the font lacks, and the display would
  // show that as if it were the reading.
  for (const char of text)
    if (char !== " " && !font.chars[char])
      throw new Error(
        `transform:render-text cannot draw ${JSON.stringify(char)} in "${text}": the size-${fontSize} font has no such character.`,
      );

  // print() wraps text wider than the canvas and drops characters in the
  // process, so a text that does not fit is refused instead.
  const textWidth = measureText(font, text);
  if (textWidth > width)
    throw new Error(
      `transform:render-text: "${text}" is ${textWidth} px wide at size ${fontSize}, wider than the ${width} px canvas.`,
    );

  const textHeight = measureTextHeight(font, text, width);
  if (textHeight > height)
    throw new Error(
      `transform:render-text: "${text}" is ${textHeight} px tall at size ${fontSize}, taller than the ${height} px canvas.`,
    );

  const image = new Jimp({ width, height, color: 0x000000ff });

  image.print({
    font,
    x: 0,
    y: 0,
    text: {
      text,
      alignmentX: HorizontalAlign.CENTER,
      alignmentY: VerticalAlign.MIDDLE,
    },
    maxWidth: width,
    maxHeight: height,
  });

  const rgba = image.bitmap.data;
  const rgb = Buffer.alloc(width * height * 3);
  for (let from = 0, to = 0; from < rgba.length; from += 4) {
    rgb[to++] = rgba[from];
    rgb[to++] = rgba[from + 1];
    rgb[to++] = rgba[from + 2];
  }
  const frame = rgb.toString("base64");

  frameCache.set(key, frame);
  if (frameCache.size > FRAME_CACHE_LIMIT)
    frameCache.delete(frameCache.keys().next().value as string);

  return frame;
}

export default class RenderText extends Transform {
  declare config: RenderTextConfig;
  honorsTargeting = false;

  constructor(config: RenderTextConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    await super.register();

    // The schema range is 8 to 128, but only five sizes in it exist.
    if (!Object.hasOwn(FONT_PATHS, this.config.fontSize))
      throw new Error(
        `"transform:render-text" has no white font at size ${this.config.fontSize}; the sizes are ${Object.keys(FONT_PATHS).join(", ")}.`,
      );
  }

  // Decoding a font takes seconds on a Pi Zero, so it happens here and not at
  // the first redraw.
  async enable() {
    await loadWhiteFont(this.config.fontSize);
    await super.enable();
  }

  async transform(message: Message, _traceId: string) {
    const text = this.interpolateConfigString(this.config.text, { message });

    return renderText(
      text,
      this.config.fontSize,
      this.config.width,
      this.config.height,
    );
  }

  // no-op
  transformSingle(value: number, _config: RenderTextConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:render-text",
  description:
    "Replaces the message with a bitmap of white text centered on a black canvas, as a base64 string that output:st7735 draws with source: bitmap. Throws when the text does not fit, rather than wrapping it.",
  options: {
    text: {
      type: "string",
      description:
        "The text to draw. Supports ${...} interpolation, so ${message.temp} puts a reading in it.",
      required: true,
      interpolated: true,
    },
    fontSize: {
      type: "number",
      description:
        "Height of the font in pixels. Only 8, 16, 32, 64 and 128 exist.",
      default: 64,
      integer: true,
      min: 8,
      max: 128,
      unit: "px",
    },
    width: {
      type: "number",
      description:
        "Canvas width in pixels. Must equal the width of the output:st7735 step that draws it.",
      required: true,
      integer: true,
      min: 1,
      unit: "px",
    },
    height: {
      type: "number",
      description:
        "Canvas height in pixels. Must equal the height of the output:st7735 step that draws it.",
      required: true,
      integer: true,
      min: 1,
      unit: "px",
    },
  },
};
