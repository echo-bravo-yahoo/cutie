import { before, describe, it } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, setGlobals } from "../../src/index.js";
import { UNITS } from "../../src/transforms/convert.js";
import Task from "../../src/util/Task.js";
import { validateConfig } from "../../src/util/validate.js";

const fakeLogger = {
  emit: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logListeners: [] as Array<unknown>,
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
      { type: "transform:javascript", command: "21 * 2" },
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
            ? { ...code, command: `'{"a":1}'` }
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
            command: "({ a: 1, b: [2] })",
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
              command: "1",
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
