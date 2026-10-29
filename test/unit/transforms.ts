import { before, describe, it } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, setGlobals } from "../../src/index.js";
import ST7735 from "../../src/outputs/st7735.js";
import { UNITS } from "../../src/transforms/convert.js";
import {
  frameCache,
  loadWhiteFont,
  renderText,
} from "../../src/transforms/render-text.js";
import Task from "../../src/util/Task.js";
import { validateConfig } from "../../src/util/validate.js";
import { necToBits } from "../../src/util/bitbang/adapters/nec.js";
import { necReceiverEdges } from "../helpers.js";

const fakeLogger = {
  emit: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logListeners: [] as Array<unknown>,
  addListener(listener: unknown) {
    this.logListeners.push(listener);
  },
  removeListener(listener: unknown) {
    const index = this.logListeners.indexOf(listener);
    if (index !== -1) this.logListeners.splice(index, 1);
  },
  logger: {
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => fakeLogger,
  },
};

function taskWith(steps: Array<any>, name: string) {
  return new Task({ steps }, name);
}

async function through(step: any, message: unknown, name = "through") {
  const task = taskWith([step], name);
  await task.register();

  return task.startMessage(message as never);
}

async function errorsFor(step: object) {
  return validateConfig(
    { tasks: { t: { steps: [step] } } },
    { configPath: "/tmp/x.json" },
  );
}

describe("transform options", function () {
  before(function () {
    setGlobals({
      tasks: [],
      connections: [],
      version: "test",
      logger: fakeLogger,
      eventBus: new EventEmitter(),
      configDir: process.cwd(),
    } as unknown as Globals);
  });

  describe("a code transform's outputType", function () {
    const CODE = [
      { type: "transform:javascript", command: "return 21 * 2" },
      { type: "transform:shell", command: "echo 42" },
    ];

    for (const code of CODE) {
      it(`is required by ${code.type}, at registration`, async function () {
        const errors = await errorsFor(code);

        expect(errors).to.deep.include({
          severity: "error",
          path: "tasks.t.steps[0].outputType",
          message: "missing required option; expected string",
        });
      });

      it(`rejects an unrecognized value on ${code.type}, listing all four`, async function () {
        const errors = await errorsFor({ ...code, outputType: "nonsense" });

        expect(errors).to.deep.include({
          severity: "error",
          path: "tasks.t.steps[0].outputType",
          message: '"nonsense" is not one of: object, string, number, any',
        });
      });

      it(`coerces identically on ${code.type} for the same input`, async function () {
        const emitting = { ...code, command: "echo '{\"a\":1}'" };
        const source =
          code.type === "transform:javascript"
            ? { ...code, command: `return '{"a":1}'` }
            : emitting;

        expect(
          await through(
            { ...source, outputType: "object" },
            undefined,
            "object",
          ),
        ).to.deep.equal({ a: 1 });
        expect(
          await through(
            { ...source, outputType: "string" },
            undefined,
            "string",
          ),
        ).to.be.a("string");
      });
    }

    it("hands back an object unchanged on javascript with any", async function () {
      expect(
        await through(
          {
            type: "transform:javascript",
            command: "return { a: 1, b: [2] }",
            outputType: "any",
          },
          undefined,
          "javascript any",
        ),
      ).to.deep.equal({ a: 1, b: [2] });
    });

    it("hands back the raw text on shell with any", async function () {
      const result = await through(
        { type: "transform:shell", command: "echo hello", outputType: "any" },
        undefined,
        "shell any",
      );

      expect(result).to.be.a("string");
      expect(String(result)).to.equal("hello\n");
    });

    it("rejects naming both a command and a codePath", async function () {
      await expect(
        taskWith(
          [
            {
              type: "transform:javascript",
              command: "return 1",
              codePath: "./x.js",
              outputType: "number",
            },
          ],
          "both sources",
        ).register(),
      ).to.be.rejectedWith(/"codePath" cannot be combined with "command"/);
    });

    it("rejects naming neither", async function () {
      await expect(
        taskWith(
          [{ type: "transform:javascript", outputType: "number" }],
          "no source",
        ).register(),
      ).to.be.rejectedWith(/needs either a "codePath" or a "command"/);
    });
  });

  describe("transform:convert", function () {
    // Not exact equality: a psi round trip goes through a scale factor that is
    // itself inexact in binary floating point.
    const TOLERANCE = 1e-9;

    const ROUND_TRIPS = [
      {
        dimension: "temperature",
        from: "celsius",
        to: "fahrenheit",
        value: 21.1,
      },
      { dimension: "pressure", from: "hectopascal", to: "psi", value: 1013.25 },
      { dimension: "length", from: "meter", to: "foot", value: 3.5 },
    ];

    for (const trip of ROUND_TRIPS) {
      it(`round-trips a ${trip.dimension}`, async function () {
        const there = (await through(
          { type: "transform:convert", from: trip.from, to: trip.to },
          trip.value,
          `${trip.from} to ${trip.to}`,
        )) as number;
        const back = (await through(
          { type: "transform:convert", from: trip.to, to: trip.from },
          there,
          `${trip.to} to ${trip.from}`,
        )) as number;

        expect(back).to.be.closeTo(trip.value, TOLERANCE);
      });
    }

    // Pins the offset-versus-scale distinction: a pure ratio would put absolute
    // zero at 0 celsius.
    it("puts absolute zero at -273.15 celsius", async function () {
      expect(
        await through(
          { type: "transform:convert", from: "kelvin", to: "celsius" },
          0,
          "absolute zero",
        ),
      ).to.equal(-273.15);
    });

    it("keeps 21.1 celsius exactly 69.98 fahrenheit", async function () {
      expect(
        await through(
          { type: "transform:convert", from: "celsius", to: "fahrenheit" },
          21.1,
          "exactness",
        ),
      ).to.equal(69.98);
    });

    it("rejects a pair from different dimensions", async function () {
      await expect(
        taskWith(
          [{ type: "transform:convert", from: "celsius", to: "pascal" }],
          "cross dimension",
        ).register(),
      ).to.be.rejectedWith(
        /cannot convert celsius \(temperature\) to pascal \(pressure\)/,
      );
    });

    it("rejects a conversion to the same unit", async function () {
      await expect(
        taskWith(
          [{ type: "transform:convert", from: "celsius", to: "celsius" }],
          "same unit",
        ).register(),
      ).to.be.rejectedWith(/both "celsius".*would do nothing/);
    });

    it("lists the accepted units for an unknown one, before any message", async function () {
      const errors = await errorsFor({
        type: "transform:convert",
        from: "furlongs",
        to: "meter",
      });

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].from",
        message: `"furlongs" is not one of: ${UNITS.join(", ")}`,
      });
    });

    it("checks the units inside the multi-path form too", async function () {
      await expect(
        taskWith(
          [
            {
              type: "transform:convert",
              paths: { temp: { from: "celsius", to: "pascal" } },
            },
          ],
          "cross dimension in paths",
        ).register(),
      ).to.be.rejectedWith(/at path "temp"/);
    });
  });

  describe("transform:accumulate", function () {
    it("emits on the count-th message", async function () {
      const task = taskWith(
        [{ type: "transform:accumulate", count: 5 }],
        "counts to five",
      );
      await task.register();

      const settled = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => task.startMessage(n)),
      );

      expect(settled.slice(0, 4)).to.deep.equal([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(settled[4]).to.deep.equal([1, 2, 3, 4, 5]);
    });

    it("emits a partial batch once maxAge passes", async function (context) {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      const batches: Array<unknown> = [];
      const task = taskWith(
        [{ type: "transform:accumulate", count: 100, maxAge: "1s" }],
        "ages out",
      );
      await task.register();
      task.endMessage = async (message) => {
        batches.push(message);
        return message;
      };

      await Promise.all([1, 2, 3].map((n) => task.startMessage(n)));
      expect(batches).to.deep.equal([]);

      context.mock.timers.tick(1000);

      expect(batches).to.deep.equal([[1, 2, 3]]);
    });

    it("resets the timer when the count flushes first", async function (context) {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      const batches: Array<unknown> = [];
      const task = taskWith(
        [{ type: "transform:accumulate", count: 2, maxAge: "1s" }],
        "count wins",
      );
      await task.register();
      task.endMessage = async (message) => {
        batches.push(message);
        return message;
      };

      await task.startMessage(1);
      await task.startMessage(2);
      context.mock.timers.tick(5000);

      // One batch from the count, and no empty second batch from the timer.
      expect(batches).to.deep.equal([[1, 2]]);
    });

    it("flushes what is pending when it is disabled", async function () {
      const batches: Array<unknown> = [];
      const task = taskWith(
        [{ type: "transform:accumulate", count: 10 }],
        "flushes on shutdown",
      );
      await task.register();
      task.endMessage = async (message) => {
        batches.push(message);
        return message;
      };

      await task.startMessage(1);
      await task.startMessage(2);
      await task.steps[0].disable();

      expect(batches).to.deep.equal([[1, 2]]);
    });

    it("is rejected without a count", async function () {
      const errors = await errorsFor({ type: "transform:accumulate" });

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].count",
        message: "missing required option; expected number",
      });
    });
  });

  describe("transform:debounce", function () {
    it("resets the timer on every message, so a steady drip never flushes", async function (context) {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      const batches: Array<unknown> = [];
      const task = taskWith(
        [{ type: "transform:debounce", idleMs: 100 }],
        "steady drip",
      );
      await task.register();
      task.endMessage = async (message) => {
        batches.push(message);
        return message;
      };

      for (let i = 0; i < 5; i++) {
        await task.startMessage(i);
        context.mock.timers.tick(50);
      }

      expect(batches).to.deep.equal([]);
    });

    it("flushes the held batch once nothing new arrives for idleMs", async function (context) {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      const batches: Array<unknown> = [];
      const task = taskWith(
        [{ type: "transform:debounce", idleMs: 50 }],
        "goes idle",
      );
      await task.register();
      task.endMessage = async (message) => {
        batches.push(message);
        return message;
      };

      await task.startMessage(1);
      await task.startMessage(2);
      await task.startMessage(3);
      expect(batches).to.deep.equal([]);

      context.mock.timers.tick(50);

      expect(batches).to.deep.equal([[1, 2, 3]]);
    });

    it("flushes what is pending when it is disabled", async function () {
      const batches: Array<unknown> = [];
      const task = taskWith(
        [{ type: "transform:debounce", idleMs: 1000 }],
        "flushes on shutdown",
      );
      await task.register();
      task.endMessage = async (message) => {
        batches.push(message);
        return message;
      };

      await task.startMessage(1);
      await task.startMessage(2);
      await task.steps[0].disable();

      expect(batches).to.deep.equal([[1, 2]]);
    });

    it("is rejected without idleMs", async function () {
      const errors = await errorsFor({ type: "transform:debounce" });

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].idleMs",
        message: "missing required option; expected number",
      });
    });
  });

  describe("transform:ir-pulses", function () {
    // The real, hardware-verified projector "mute" command (address 0x55,
    // command 0x52, extendedAddress 0x83): its own receiver edges, not a
    // synthetic frame, so this proves capture is exact for something a real
    // projector actually responds to.
    const muteEdges = necReceiverEdges(
      necToBits({ address: 0x55, command: 0x52, extendedAddress: 0x83 }),
    );
    const mutePulses = [
      9000, 4500, 563, 1688, 563, 563, 563, 1688, 563, 563, 563, 1688, 563, 563,
      563, 1688, 563, 563, 563, 1688, 563, 1688, 563, 563, 563, 563, 563, 563,
      563, 563, 563, 563, 563, 1688, 563, 563, 563, 1688, 563, 563, 563, 563,
      563, 1688, 563, 563, 563, 1688, 563, 563, 563, 1688, 563, 563, 563, 1688,
      563, 1688, 563, 563, 563, 1688, 563, 563, 563, 1688, 563,
    ];

    it("converts the real mute command's own edges into its exact pulse array", async function () {
      expect(
        await through({ type: "transform:ir-pulses" }, muteEdges, "mute edges"),
      ).to.deep.equal({ pulses: mutePulses });
    });

    it("drops the (null, null) endNotify sentinel rather than producing a bogus trailing duration", async function () {
      const withSentinel = [...muteEdges, { level: null, tick: null }];

      expect(
        await through(
          { type: "transform:ir-pulses" },
          withSentinel,
          "mute edges with sentinel",
        ),
      ).to.deep.equal({ pulses: mutePulses });
    });

    it("rejects a non-array message", async function () {
      await expect(
        through(
          { type: "transform:ir-pulses" },
          { not: "an array" },
          "not an array",
        ),
      ).to.be.rejectedWith(/expects an array/);
    });
  });

  describe("transform:render-text", function () {
    const RENDER = {
      type: "transform:render-text",
      width: 160,
      height: 80,
    };

    // The smallest rectangle holding every pixel that is not black.
    function inkBox(frame: string, width: number, height: number) {
      const bytes = Buffer.from(frame, "base64");
      const box = { left: width, right: -1, top: height, bottom: -1 };

      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          const at = (y * width + x) * 3;
          if (!bytes[at] && !bytes[at + 1] && !bytes[at + 2]) continue;
          box.left = Math.min(box.left, x);
          box.right = Math.max(box.right, x);
          box.top = Math.min(box.top, y);
          box.bottom = Math.max(box.bottom, y);
        }

      return box;
    }

    it("returns a base64 string holding width x height x 3 bytes", async function () {
      const frame = await renderText("67F", 64, 160, 80);

      expect(frame).to.be.a("string").with.lengthOf(51200);
      expect(Buffer.from(frame, "base64")).to.have.lengthOf(38400);
    });

    it("interpolates its text from the message", async function () {
      expect(
        await through(
          { ...RENDER, text: "${message.temp}F" },
          { temp: 67 },
          "interpolated",
        ),
      ).to.equal(await renderText("67F", 64, 160, 80));
    });

    it("draws a whole-degree reading in the large font where the node shows it", async function () {
      expect(
        inkBox(await renderText("67F", 64, 160, 80), 160, 80),
      ).to.deep.equal({ left: 27, right: 132, top: 15, bottom: 61 });
    });

    it("draws a two-decimal reading in the small font where the node shows it", async function () {
      expect(
        inkBox(await renderText("72.64F", 32, 160, 80), 160, 80),
      ).to.deep.equal({ left: 32, right: 129, top: 28, bottom: 51 });
    });

    describe("caching", function () {
      it("returns the identical string for the same inputs", async function () {
        expect(await renderText("55F", 64, 160, 80)).to.equal(
          await renderText("55F", 64, 160, 80),
        );
      });

      it("holds at most 32 frames", async function () {
        for (let degrees = 0; degrees < 40; degrees += 1)
          await renderText(`${degrees}F`, 32, 160, 80);

        expect(frameCache.size).to.be.at.most(32);
      });

      it("shares one font load between callers of a size", function () {
        expect(loadWhiteFont(32)).to.equal(loadWhiteFont(32));
      });
    });

    describe("a text it cannot draw", function () {
      it("throws when the text is wider than the canvas, naming both widths", async function () {
        await expect(renderText("72.6F", 64, 160, 80)).to.be.rejectedWith(
          /"72.6F" is 165 px wide at size 64, wider than the 160 px canvas/,
        );
      });

      it("throws when the text is taller than the canvas", async function () {
        await expect(renderText("67F", 64, 160, 60)).to.be.rejectedWith(
          /taller than the 60 px canvas/,
        );
      });

      it("throws for a character the font lacks", async function () {
        await expect(renderText("字", 64, 160, 80)).to.be.rejectedWith(
          /no such character/,
        );
      });

      it("throws for a newline", async function () {
        await expect(renderText("6\n7", 32, 160, 80)).to.be.rejectedWith(
          /no such character/,
        );
      });

      it("throws for a reading that interpolated to nothing", async function () {
        await expect(
          through({ ...RENDER, text: "${message.temp}F" }, {}, "no reading"),
        ).to.be.rejectedWith(/"undefinedF" is \d+ px wide at size 64/);
      });
    });

    describe("its options", function () {
      it("requires text, width and height", async function () {
        for (const option of ["text", "width", "height"]) {
          const step: Record<string, unknown> = { ...RENDER, text: "67F" };
          delete step[option];

          expect(await errorsFor(step)).to.deep.include({
            severity: "error",
            path: `tasks.t.steps[0].${option}`,
            message: `missing required option; expected ${option === "text" ? "string" : "number"}`,
          });
        }
      });

      it("rejects a fontSize outside 8 to 128", async function () {
        expect(
          await errorsFor({ ...RENDER, text: "67F", fontSize: 200 }),
        ).to.deep.include({
          severity: "error",
          path: "tasks.t.steps[0].fontSize",
          message: "200 is out of range; expected 8 to 128",
        });
      });

      for (const fontSize of [48, 100])
        it(`refuses size ${fontSize}, which is in range but has no font, at registration`, async function () {
          await expect(
            through({ ...RENDER, text: "67F", fontSize }, {}, "odd size"),
          ).to.be.rejectedWith(/has no white font at size/);
        });

      it("refuses path, since it transforms the whole message", async function () {
        await expect(
          through({ ...RENDER, text: "67F", path: "temp" }, {}, "with a path"),
        ).to.be.rejectedWith(/does not accept "path"/);
      });
    });

    it("feeds output:st7735 a bitmap it draws unchanged", async function () {
      const task = taskWith(
        [
          { ...RENDER, text: "${message.temp}F" },
          {
            type: "output:st7735",
            source: "bitmap",
            width: 160,
            height: 80,
            virtual: true,
            spiDevice: "/dev/spidev0.1",
            dcPin: 9,
            backlightPin: 12,
          },
        ],
        "render into a panel",
      );
      await task.register();

      const frame = (await task.startMessage({ temp: 67 } as never)) as string;
      const drawn = await (task.steps[1] as ST7735).rasterFrom(frame as never);
      const expected = Buffer.from(
        await renderText("67F", 64, 160, 80),
        "base64",
      );

      expect(drawn.width).to.equal(160);
      expect(drawn.height).to.equal(80);
      for (let pixel = 0; pixel < 160 * 80; pixel += 1)
        expect(
          Array.from(drawn.data.subarray(pixel * 4, pixel * 4 + 3)),
        ).to.deep.equal(
          Array.from(expected.subarray(pixel * 3, pixel * 3 + 3)),
        );
    });
  });

  describe("transform:round's precision", function () {
    it("rounds to an integer when it is zero", async function () {
      expect(
        await through(
          { type: "transform:round", precision: 0 },
          21.456,
          "zero precision",
        ),
      ).to.equal(21);
    });

    it("stays distinguishable from absent in the resolved config", async function () {
      const task = new Task({ steps: [] }, "precision resolution");

      const explicit = await task.importStep(
        { type: "transform:round", precision: 0 } as never,
        0,
      );
      const absent = await task.importStep(
        { type: "transform:round" } as never,
        1,
      );

      expect((explicit.config as { precision?: number }).precision).to.equal(0);
      expect((absent.config as { precision?: number }).precision).to.equal(
        undefined,
      );
    });

    it("rejects a negative or fractional precision", async function () {
      expect(
        await errorsFor({ type: "transform:round", precision: -1 }),
      ).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].precision",
        message: "-1 is out of range; expected 0 to Infinity",
      });

      expect(
        await errorsFor({ type: "transform:round", precision: 1.5 }),
      ).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].precision",
        message: "1.5 is not an integer",
      });
    });
  });

  describe("transform:munge", function () {
    it("rejects an unrecognized op", async function () {
      await expect(
        taskWith(
          [{ type: "transform:munge", path: "a", op: "nonsense" }],
          "bad op",
        ).register(),
      ).to.be.rejectedWith(/"op" is "nonsense".*not one of/);
    });

    it("rejects a rename with no destination", async function () {
      await expect(
        taskWith(
          [{ type: "transform:munge", path: "a", op: "rename" }],
          "no destination",
        ).register(),
      ).to.be.rejectedWith(/needs a "to" naming where the value goes/);
    });

    it("rejects the same mistakes inside the multi-path form", async function () {
      await expect(
        taskWith(
          [{ type: "transform:munge", paths: { a: { op: "rename" } } }],
          "no destination in paths",
        ).register(),
      ).to.be.rejectedWith(/at path "a".*needs a "to"/);
    });
  });

  describe("an array at the target", function () {
    // walksArrays is what separates the two: transform:round maps over the
    // entries, transform:aggregate collapses them.
    it("is collapsed at a path when the transform does not walk arrays", async function () {
      expect(
        await through(
          { type: "transform:aggregate", path: "temp", aggregation: "sum" },
          [{ temp: 1 }, { temp: 2 }],
          "collapses at a path",
        ),
      ).to.deep.equal({ temp: 3 });
    });

    it("is collapsed at each paths entry when the transform does not walk arrays", async function () {
      expect(
        await through(
          {
            type: "transform:aggregate",
            paths: {
              temp: { aggregation: "sum" },
              hum: { aggregation: "sum" },
            },
          },
          [
            { temp: 1, hum: 10 },
            { temp: 2, hum: 20 },
          ],
          "collapses at each paths entry",
        ),
      ).to.deep.equal({ temp: 3, hum: 30 });
    });

    it("is collapsed whole when the transform does not walk arrays", async function () {
      expect(
        await through(
          { type: "transform:aggregate", aggregation: "sum" },
          [1, 2, 3],
          "collapses the whole message",
        ),
      ).to.deep.equal(6);
    });

    it("is mapped over when the transform does walk arrays", async function () {
      expect(
        await through(
          { type: "transform:round", path: "temp", precision: 1 },
          [{ temp: 1.24 }, { temp: 2.28 }],
          "maps over the entries",
        ),
      ).to.deep.equal([{ temp: 1.2 }, { temp: 2.3 }]);
    });

    it("is rejected when a basePath points at something else", async function () {
      await expect(
        through(
          { type: "transform:round", basePath: "readings", path: "temp" },
          { readings: { temp: 1.24 } },
          "basePath at an object",
        ),
      ).to.be.rejectedWith(
        /"basePath" "readings" should point at an array, but found an object/,
      );
    });
  });

  describe("transform:uglify", function () {
    it("rejects spaces, which is prettify's option", async function () {
      await expect(
        taskWith(
          [{ type: "transform:uglify", spaces: 2 }],
          "uglify with spaces",
        ).register(),
      ).to.be.rejectedWith(/does not accept "spaces"/);
    });

    it("matches prettify with a spaces of 0", async function () {
      const message = { a: 1, b: [2, 3] };

      expect(
        await through({ type: "transform:uglify" }, message, "uglify"),
      ).to.equal(
        await through(
          { type: "transform:prettify", spaces: 0 },
          message,
          "prettify with no indent",
        ),
      );
    });
  });
});
