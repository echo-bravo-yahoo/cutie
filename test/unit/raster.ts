import { describe, it } from "node:test";

import { expect } from "chai";

import {
  decodeBitmap,
  fitRaster,
  quantize,
  sourceValueFor,
  validateSourceConfig,
  Raster,
  RGB,
  SourceConfig,
} from "../../src/util/raster.js";

function solidRaster(
  width: number,
  height: number,
  [red, green, blue]: RGB,
  alpha = 255,
): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = red;
    data[index * 4 + 1] = green;
    data[index * 4 + 2] = blue;
    data[index * 4 + 3] = alpha;
  }
  return { width, height, data };
}

function pixelAt(raster: Raster, x: number, y: number): Array<number> {
  const at = (y * raster.width + x) * 4;
  return [...raster.data.slice(at, at + 4)];
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const YELLOW: RGB = [255, 255, 0];

describe("raster", function () {
  describe("decodeBitmap", function () {
    it("accepts an array of bytes", function () {
      const decoded = decodeBitmap([0, 1, 2, 3], 4);

      expect([...decoded]).to.deep.equal([0, 1, 2, 3]);
    });

    it("accepts the same bytes as base64", function () {
      const encoded = Buffer.from([0, 1, 2, 3]).toString("base64");
      const decoded = decodeBitmap(encoded, 4);

      expect([...decoded]).to.deep.equal([0, 1, 2, 3]);
    });

    it("rejects a bitmap of the wrong length, naming both", function () {
      expect(() => decodeBitmap([0, 1, 2], 4)).to.throw(/4 bytes.*got 3/);
    });

    it("rejects a value that is not a byte", function () {
      expect(() => decodeBitmap([0, 300, 2, 3], 4)).to.throw(/index 1 is 300/);
    });

    it("rejects a value that is neither a string nor an array", function () {
      expect(() => decodeBitmap({ frame: [] }, 4)).to.throw(/base64 string/);
    });
  });

  describe("fitRaster", function () {
    it("preserves the aspect ratio on contain, letterboxing the rest", function () {
      // 2:1 source into a square panel, so the image occupies the middle two
      // rows and the background fills the row above and below it.
      const fitted = fitRaster(
        solidRaster(4, 2, BLACK),
        4,
        4,
        "contain",
        WHITE,
      );

      expect(pixelAt(fitted, 0, 0)).to.deep.equal([255, 255, 255, 255]);
      expect(pixelAt(fitted, 0, 1)).to.deep.equal([0, 0, 0, 255]);
      expect(pixelAt(fitted, 3, 2)).to.deep.equal([0, 0, 0, 255]);
      expect(pixelAt(fitted, 3, 3)).to.deep.equal([255, 255, 255, 255]);
    });

    it("leaves no background showing on cover", function () {
      const fitted = fitRaster(solidRaster(4, 2, BLACK), 4, 4, "cover", WHITE);

      expect([...fitted.data].filter((_byte, at) => at % 4 !== 3)).to.satisfy(
        (channels: Array<number>) => channels.every((value) => value === 0),
      );
    });

    it("fills the panel on stretch", function () {
      const fitted = fitRaster(
        solidRaster(4, 2, BLACK),
        4,
        4,
        "stretch",
        WHITE,
      );

      expect(pixelAt(fitted, 0, 0)).to.deep.equal([0, 0, 0, 255]);
      expect(pixelAt(fitted, 3, 3)).to.deep.equal([0, 0, 0, 255]);
    });

    it("resolves transparency against the background", function () {
      const fitted = fitRaster(
        solidRaster(4, 4, BLACK, 0),
        4,
        4,
        "stretch",
        YELLOW,
      );

      expect(pixelAt(fitted, 2, 2)).to.deep.equal([255, 255, 0, 255]);
    });

    it("returns a panel-sized raster whatever the source", function () {
      const fitted = fitRaster(solidRaster(97, 13, BLACK), 17, 7);

      expect(fitted.width).to.equal(17);
      expect(fitted.height).to.equal(7);
      expect(fitted.data.length).to.equal(17 * 7 * 4);
    });
  });

  describe("quantize", function () {
    const palette = [WHITE, BLACK, YELLOW];

    it("maps each palette colour to its own index", function () {
      const indices = ([WHITE, BLACK, YELLOW] as Array<RGB>).map(
        (colour) => quantize(solidRaster(2, 2, colour), palette, false)[0],
      );

      expect(indices).to.deep.equal([0, 1, 2]);
    });

    it("maps a colour to its nearest palette entry", function () {
      const nearlyYellow = quantize(
        solidRaster(2, 2, [240, 230, 30]),
        palette,
        false,
      );

      expect([...nearlyYellow]).to.deep.equal([2, 2, 2, 2]);
    });

    it("returns one index per pixel", function () {
      const indices = quantize(solidRaster(17, 7, WHITE), palette, false);

      expect(indices.length).to.equal(17 * 7);
    });

    it("dithers a colour the palette cannot hold into a mix of entries", function () {
      // Mid grey sits between white and black, so error diffusion has to spend
      // both. Without dithering every pixel would round the same way.
      const dithered = quantize(solidRaster(8, 8, [128, 128, 128]), [
        WHITE,
        BLACK,
      ]);

      expect(new Set(dithered)).to.deep.equal(new Set([0, 1]));
    });
  });

  describe("validateSourceConfig", function () {
    it("rejects a source it cannot draw", function () {
      expect(() =>
        validateSourceConfig(
          { source: "video" } as unknown as SourceConfig,
          "d",
        ),
      ).to.throw(/"image" or "bitmap"/);
    });

    it("rejects a file and a path together", function () {
      expect(() =>
        validateSourceConfig(
          { source: "image", file: "/frame.png", path: "frame" },
          "d",
        ),
      ).to.throw(/not both/);
    });

    it("rejects a file for a bitmap, which arrives in the message", function () {
      expect(() =>
        validateSourceConfig({ source: "bitmap", file: "/frame.bin" }, "d"),
      ).to.throw(/takes a path rather than a file/);
    });

    it("accepts either one on its own", function () {
      expect(() =>
        validateSourceConfig({ source: "image", file: "/frame.png" }, "d"),
      ).to.not.throw();
      expect(() =>
        validateSourceConfig({ source: "bitmap", path: "frame" }, "d"),
      ).to.not.throw();
      expect(() =>
        validateSourceConfig({ source: "bitmap" }, "d"),
      ).to.not.throw();
    });
  });

  describe("sourceValueFor", function () {
    const bitmap: SourceConfig = { source: "bitmap" };

    it("reads a fixed file straight from the config", function () {
      expect(
        sourceValueFor({ source: "image", file: "/frame.png" }, { frame: "x" }),
      ).to.equal("/frame.png");
    });

    it("reads a path out of the message", function () {
      expect(
        sourceValueFor({ ...bitmap, path: "nested.frame" }, {
          nested: { frame: [1, 2, 3] },
        } as never),
      ).to.deep.equal([1, 2, 3]);
    });

    it("takes the whole message when no path is given", function () {
      expect(sourceValueFor(bitmap, [1, 2, 3])).to.deep.equal([1, 2, 3]);
    });
  });
});
