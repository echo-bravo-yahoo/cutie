import { before, describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, setGlobals } from "../../src/index.js";
import Read from "../../src/util/Read.js";
import { listModules } from "../../src/util/modules.js";
import Task from "../../src/util/Task.js";
import { validateConfig } from "../../src/util/validate.js";

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

// The reads that cannot stand in for anything, because there is nothing outside
// the process for them to stand in for.
const NO_VIRTUAL = ["constant", "random", "stash"];

function taskWith(step: any, name: string) {
  return new Task({ steps: [step] }, name);
}

async function readOnce(step: any, name: string, message: unknown = "in") {
  const task = taskWith(step, name);
  await task.register();

  return task.startMessage(message as never);
}

async function errorsFor(step: object) {
  return validateConfig(
    { tasks: { t: { steps: [step] } } },
    { configPath: "/tmp/x.json" },
  );
}

describe("reads", function () {
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

  describe("a virtual read", function () {
    it("produces a BME280-shaped reading without opening the sensor", async function (context) {
      const importOptional = context.mock.fn(async () => {
        throw new Error("importOptional should not have been called");
      });
      mock.module("../../src/util/optional-dependency.js", {
        namedExports: { importOptional },
      });

      const reading = (await readOnce(
        { type: "read:bme280", virtual: true },
        "a virtual bme280",
      )) as Record<string, number>;

      for (const field of ["temp", "humidity", "pressure"])
        expect(reading, field).to.have.property(field);
      expect(reading).to.have.property("metadata");
      expect(importOptional.mock.callCount()).to.equal(0);
    });

    it("produces a BME680-shaped reading, gas resistance included", async function () {
      const reading = (await readOnce(
        { type: "read:bme680", virtual: true },
        "a virtual bme680",
      )) as Record<string, number>;

      for (const field of ["temp", "humidity", "pressure", "gas"])
        expect(reading, field).to.have.property(field);
    });

    it("returns read:file's virtualValue without touching the disk", async function () {
      expect(
        await readOnce(
          {
            type: "read:file",
            path: "/nowhere/at/all",
            virtual: true,
            virtualValue: "pretend contents",
          },
          "a virtual file read",
        ),
      ).to.equal("pretend contents");
    });

    it("returns the empty string when read:file names no virtualValue", async function () {
      expect(
        await readOnce(
          { type: "read:file", path: "/nowhere/at/all", virtual: true },
          "a virtual file read with no value",
        ),
      ).to.equal("");
    });

    it("is rejected by read:constant, naming the module", async function () {
      await expect(
        taskWith(
          { type: "read:constant", value: 1, virtual: true },
          "virtual constant",
        ).register(),
      ).to.be.rejectedWith(/"read:constant" does not accept "virtual"/);
    });

    it("is rejected by read:random, naming the module", async function () {
      await expect(
        taskWith(
          {
            type: "read:random",
            min: 0,
            max: 10,
            minStep: 1,
            maxStep: 2,
            start: 5,
            virtual: true,
          },
          "virtual random",
        ).register(),
      ).to.be.rejectedWith(/"read:random" does not accept "virtual"/);
    });

    it("is off by default and when set false", async function () {
      for (const virtual of [undefined, false]) {
        const step = {
          type: "read:file",
          path: "/nowhere/at/all",
          virtualValue: "pretend",
          ...(virtual === undefined ? {} : { virtual }),
        };

        await expect(
          readOnce(step, `a real file read ${virtual}`),
          `virtual: ${virtual}`,
        ).to.be.rejectedWith(/ENOENT/);
      }
    });

    // Driven from the filesystem so a new read cannot quietly skip the choice
    // between supporting virtual and refusing it.
    it("is either implemented or refused by every read on disk", async function () {
      for (const subKind of (await listModules()).read) {
        const module = await import(`../../src/reads/${subKind}.js`);
        const implemented =
          (module.default.prototype as Read).virtualRead !== undefined;

        expect(
          implemented,
          `read:${subKind} should ${NO_VIRTUAL.includes(subKind) ? "refuse" : "implement"} virtual`,
        ).to.equal(!NO_VIRTUAL.includes(subKind));
      }
    });
  });

  describe("read:random", function () {
    const bounds = { min: 20, max: 30, minStep: 0.05, maxStep: 0.5, start: 22 };

    for (const missing of Object.keys(bounds)) {
      it(`is rejected without ${missing}`, async function () {
        const step = { type: "read:random", ...bounds } as Record<
          string,
          unknown
        >;
        delete step[missing];

        const errors = await errorsFor(step);

        expect(errors).to.deep.include({
          severity: "error",
          path: `tasks.t.steps[0].${missing}`,
          message: "missing required option; expected number",
        });
      });
    }

    it("walks inside its bounds, one step at a time", async function () {
      const task = taskWith({ type: "read:random", ...bounds }, "walks");
      await task.register();

      let previous: number | undefined;

      for (let i = 0; i < 100; i++) {
        const value = (await task.startMessage(undefined)) as number;

        expect(value, `reading ${i}`).to.be.a("number");
        expect(value, `reading ${i}`).to.be.within(bounds.min, bounds.max);

        if (previous !== undefined) {
          const delta = Math.abs(value - previous);
          expect(delta, `delta ${i}`).to.be.within(
            bounds.minStep,
            bounds.maxStep,
          );
        }

        previous = value;
      }
    });

    it("is rejected when min is not below max", async function () {
      await expect(
        taskWith(
          { type: "read:random", ...bounds, min: 30, max: 20 },
          "inverted bounds",
        ).register(),
      ).to.be.rejectedWith(/"min" \(30\) should be less than "max" \(20\)/);
    });

    it("is rejected when minStep is not below maxStep", async function () {
      await expect(
        taskWith(
          { type: "read:random", ...bounds, minStep: 2, maxStep: 1 },
          "inverted steps",
        ).register(),
      ).to.be.rejectedWith(
        /"minStep" \(2\) should be less than "maxStep" \(1\)/,
      );
    });
  });

  describe("an I2C address", function () {
    // 0x00 through 0x07 are reserved by the I2C spec, so no device answers
    // there and a literal 0 is a mistake rather than a value to preserve.
    it("rejects 0 as out of range", async function () {
      const errors = await errorsFor({ type: "read:bme280", i2cAddress: 0 });

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].i2cAddress",
        message: "0 is out of range; expected 8 to 119",
      });
    });

    it("accepts the sensor's own address", async function () {
      expect(
        await errorsFor({ type: "read:bme280", i2cAddress: 0x76 }),
      ).to.deep.equal([]);
    });

    it("defaults to 0x76 for a BME280 and 0x77 for a BME680", async function () {
      const task = new Task({ steps: [] }, "i2c defaults");

      const bme280 = await task.importStep({ type: "read:bme280" } as never, 0);
      const bme680 = await task.importStep({ type: "read:bme680" } as never, 1);

      expect((bme280.config as { i2cAddress: number }).i2cAddress).to.equal(
        0x76,
      );
      expect((bme680.config as { i2cAddress: number }).i2cAddress).to.equal(
        0x77,
      );
    });
  });
});
