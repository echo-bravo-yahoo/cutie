import { describe, it, before, beforeEach } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { setGlobals } from "../../src/index.js";
import RandomRead from "../../src/reads/random.js";
import RandomSensor from "../../src/triggers/random.js";
import BME680 from "../../src/reads/bme680.js";
import NEC from "../../src/outputs/nec.js";
import Switchbots from "../../src/outputs/switchbots.js";
import ThermalPrinter from "../../src/outputs/thermal-printer.js";
import Aggregate from "../../src/transforms/aggregate.js";
import { Context } from "../../src/util/Transform.js";
import { importOptional } from "../../src/util/optional-dependency.js";
import { createPigpioMock } from "../helpers.js";

// A walk config with room to move: every step lands well inside the bounds.
const WALK = { start: 22, min: 20, max: 30, minStep: 0.05, maxStep: 0.5 };

describe("modules", function () {
  const captured: Array<{
    log: string;
    verbosity: string;
    topic: string;
    object?: object;
    traceId?: string;
  }> = [];

  const fakeLogger = {
    logListeners: [] as Array<unknown>,
    emit: (
      log: string,
      verbosity: string,
      topic: string,
      object?: object,
      traceId?: string,
    ) => {
      captured.push({ log, verbosity, topic, object, traceId });
    },
    info: () => {},
    warn: () => {},
    error: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  function linesMatching(pattern: string) {
    return captured.filter(({ log }) => log.includes(pattern));
  }

  before(() => {
    setGlobals({
      logger: fakeLogger,
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as any);
  });

  beforeEach(() => {
    captured.length = 0;
  });

  describe("read:random", function () {
    function reader(config: object = {}) {
      const task = new Task({ steps: [] }, "reads a random number");

      return new RandomRead(
        { type: "read:random", ...WALK, ...config } as any,
        task,
      );
    }

    // DrunkReader walks with Math.random(), so only the bounds and the size of
    // each step can be asserted, never a value.
    it("takes its first step from the configured start", async function () {
      const first = (await reader().read("ignored", "a-trace")) as number;

      expect(Math.abs(first - WALK.start)).to.be.within(
        WALK.minStep,
        WALK.maxStep,
      );
    });

    it("stays inside the configured bounds", async function () {
      const random = reader();

      for (let i = 0; i < 200; i++) {
        const value = (await random.read("ignored", "a-trace")) as number;
        expect(value).to.be.within(WALK.min, WALK.max);
      }
    });

    it("moves by one step at a time", async function () {
      const random = reader();
      let last = WALK.start;

      for (let i = 0; i < 200; i++) {
        const value = (await random.read("ignored", "a-trace")) as number;
        expect(Math.abs(value - last)).to.be.within(WALK.minStep, WALK.maxStep);
        last = value;
      }
    });

    it("starts from zero when no start is configured", async function () {
      const first = (await reader({ start: undefined, min: -10, max: 10 }).read(
        "ignored",
        "a-trace",
      )) as number;

      expect(Math.abs(first)).to.be.within(WALK.minStep, WALK.maxStep);
    });
  });

  describe("trigger:random", function () {
    // The only exercise Sensor's sample/publish scheduling gets anywhere.
    function sensorTask(name: string, config: object = {}) {
      const task = new Task(
        {
          trigger: {
            type: "trigger:random",
            ...WALK,
            samplingInterval: 1000,
            // deliberately not a multiple of the sampling interval, so the two
            // never come due on the same tick
            reportingInterval: 5500,
            sampling: { aggregation: "average" },
            ...config,
          } as any,
          steps: [],
        },
        name,
      );

      const published: Array<unknown> = [];
      // where a message lands when a task has no steps
      task.endMessage = async (message: any) => {
        published.push(message);
        return message;
      };

      return { task, published };
    }

    it("publishes its first reading as soon as it is enabled", async function (context) {
      context.mock.timers.enable({ apis: ["setInterval"] });
      const { task, published } = sensorTask("publishes on enable");

      try {
        await task.register();
        await new Promise((resolve) => setImmediate(resolve));

        expect(published).to.have.lengthOf(1);
        expect(published[0]).to.have.lengthOf(1);
      } finally {
        await task.trigger!.disable();
      }
    });

    it("samples on the sampling interval without publishing", async function (context) {
      context.mock.timers.enable({ apis: ["setInterval"] });
      const { task, published } = sensorTask("samples between reports");

      try {
        await task.register();
        await new Promise((resolve) => setImmediate(resolve));
        context.mock.timers.tick(3000);

        expect((task.trigger as RandomSensor).samples).to.have.lengthOf(3);
        expect(published).to.have.lengthOf(1);
      } finally {
        await task.trigger!.disable();
      }
    });

    it("publishes the samples it collected and then starts over", async function (context) {
      context.mock.timers.enable({ apis: ["setInterval"] });
      const { task, published } = sensorTask("reports what it sampled");

      try {
        await task.register();
        await new Promise((resolve) => setImmediate(resolve));
        context.mock.timers.tick(5500);
        await new Promise((resolve) => setImmediate(resolve));

        expect(published).to.have.lengthOf(2);
        // one sample per second up to the report at 5500ms
        expect(published[1]).to.have.lengthOf(5);
        for (const value of published[1] as Array<number>)
          expect(value).to.be.within(WALK.min, WALK.max);
        expect((task.trigger as RandomSensor).samples).to.have.lengthOf(0);
      } finally {
        await task.trigger!.disable();
      }
    });

    it("collects nothing while it is disabled", async function () {
      const { task } = sensorTask("stays quiet while disabled", {
        disabled: true,
      });
      await task.register();

      const trigger = task.trigger as RandomSensor;
      await trigger.sample();

      expect(trigger.enabled).to.equal(false);
      expect(trigger.samples).to.have.lengthOf(0);
    });
  });

  describe("read:bme680", function () {
    // Registering a non-virtual bme680 would reach for i2c, so every test
    // registers a virtual one and swaps in a sensor afterwards.
    async function bme680(name: string) {
      const task = new Task(
        { steps: [{ type: "read:bme680", virtual: true } as any] },
        name,
      );
      await task.register();

      return task.steps[0] as BME680;
    }

    it("reads a full virtual sample without any hardware", async function () {
      const sample = (await (
        await bme680("reads virtually")
      ).read("ignored", "a-trace")) as any;

      expect(sample.temp).to.be.a("number");
      expect(sample.humidity).to.be.a("number");
      expect(sample.pressure).to.be.a("number");
      expect(sample.gas).to.be.a("number");
      expect(sample.metadata.timestamp).to.be.a("date");
    });

    it("reads nothing while it is disabled", async function () {
      const sensor = await bme680("reads while disabled");
      await sensor.disable();

      expect(await sensor.read("ignored", "a-trace")).to.equal(undefined);
    });

    it("reports the sensor's gas resistance as gas", async function () {
      const sensor = await bme680("reads a real sample");
      sensor.config.virtual = false;
      sensor.sensor = {
        read: async () => ({
          temperature: 21.5,
          humidity: 40,
          pressure: 1013,
          gas_resistance: 12345,
        }),
      };

      const sample = (await sensor.read("ignored", "a-trace")) as any;

      expect(sample).to.deep.include({
        temp: 21.5,
        humidity: 40,
        pressure: 1013,
        gas: 12345,
      });
    });

    it("traces a real sample, and logs nothing for a virtual one", async function () {
      const sensor = await bme680("logs only real samples");

      await sensor.read("ignored", "a-virtual-trace");
      expect(linesMatching("Sampled new data point")).to.have.lengthOf(0);

      sensor.config.virtual = false;
      sensor.sensor = { read: async () => ({}) };
      await sensor.read("ignored", "a-real-trace");

      const [sampled] = linesMatching("Sampled new data point");
      expect(sampled.traceId).to.equal("a-real-trace");
      expect(sampled.topic).to.equal(sensor.logPrefix);
    });
  });

  describe("output:switchbots", function () {
    function switchbots(bots: Array<object>, { discovered = true } = {}) {
      const task = new Task({ steps: [] }, "drives a switchbot");
      const output = new Switchbots(
        { type: "output:switchbots", bots } as any,
        task,
      );
      const calls: Array<string> = [];

      if (discovered)
        output.devices = {
          "bot-1": {
            press: async () => {
              calls.push("press");
              return true;
            },
            handUp: async () => {
              calls.push("handUp");
              return true;
            },
            handDown: async () => {
              calls.push("handDown");
              return true;
            },
          },
        } as any;

      return { output, calls };
    }

    it("presses a bot on request", async function () {
      const { output, calls } = switchbots([{ id: "bot-1" }]);

      await output.send({ id: "bot-1", action: "press" }, "a-trace");

      expect(calls).to.deep.equal(["press"]);
    });

    it("lowers the arm to turn a normally-mounted bot on", async function () {
      const { output, calls } = switchbots([{ id: "bot-1" }]);

      await output.send({ id: "bot-1", action: "on" }, "a-trace");
      await output.send({ id: "bot-1", action: "off" }, "a-trace");

      expect(calls).to.deep.equal(["handDown", "handUp"]);
    });

    it("inverts the arm for a reverse-mounted bot", async function () {
      const { output, calls } = switchbots([
        { id: "bot-1", reverseOnOff: true },
      ]);

      await output.send({ id: "bot-1", action: "on" }, "a-trace");
      await output.send({ id: "bot-1", action: "off" }, "a-trace");

      expect(calls).to.deep.equal(["handUp", "handDown"]);
    });

    it("reports a request that names no bot or no action", async function () {
      const { output } = switchbots([{ id: "bot-1" }]);

      await expect(
        output.send({ action: "on" }, "a-trace"),
      ).to.be.rejectedWith(/\{"action":"on"\}/);
      await expect(
        output.send({ id: "bot-1" }, "a-trace"),
      ).to.be.rejectedWith(/\{"id":"bot-1"\}/);
    });

    it("lists the bots it knows when asked for one it does not", async function () {
      const { output } = switchbots([{ id: "bot-1" }]);

      await expect(
        output.send({ id: "bot-9", action: "on" }, "a-trace"),
      ).to.be.rejectedWith(/known ids are \["bot-1"\]/);
    });

    it("says when a configured bot was never discovered", async function () {
      const { output } = switchbots([{ id: "bot-1", name: "kitchen light" }], {
        discovered: false,
      });

      await expect(
        output.send({ id: "bot-1", action: "on" }, "a-trace"),
      ).to.be.rejectedWith(/kitchen light \(bot-1\) was never discovered/);
    });
  });

  describe("output:nec", function () {
    function nec(config: object = {}) {
      const task = new Task({ steps: [] }, "transmits an nec command");

      return new NEC({ type: "output:nec", ...config } as any, task);
    }

    it("transmits nothing at all when virtual", async function () {
      const output = nec({ virtual: true });
      const { calls, pigpio } = createPigpioMock();
      output.pigpio = pigpio;

      const message = { address: "0x7c", command: "0x66" };
      expect(await output.send(message, "a-trace")).to.equal(message);
      expect(calls).to.deep.equal([]);
    });

    it("transmits exactly once when it has a pigpio", async function () {
      const output = nec();
      const { calls, pigpio } = createPigpioMock();
      output.pigpio = pigpio;

      const message = { address: "0x7c", command: "0x66" };
      expect(await output.send(message, "a-trace")).to.equal(message);
      expect(calls.filter((call) => call === "waveCreate")).to.have.lengthOf(1);
    });

    it("transmits nothing when there is no pigpio to transmit with", async function () {
      const message = { address: "0x7c", command: "0x66" };

      expect(await nec().send(message, "a-trace")).to.equal(message);
    });
  });

  describe("output:thermal-printer", function () {
    // The printer's API is chainable, so every method returns the printer.
    function fakePrinter() {
      const calls: Array<string> = [];
      const printer: any = {};

      for (const method of [
        "small",
        "bold",
        "big",
        "underline",
        "printLine",
        "reset",
      ]) {
        printer[method] = (...args: Array<unknown>) => {
          calls.push(`${method}(${args.join(", ")})`);
          return printer;
        };
      }
      printer.print = (done: () => void) => {
        calls.push("print");
        done();
      };

      return { printer, calls };
    }

    function thermalPrinter({ attached = true } = {}) {
      const task = new Task({ steps: [] }, "prints a message");
      const output = new ThermalPrinter(
        { type: "output:thermal-printer" } as any,
        task,
      );
      const { printer, calls } = fakePrinter();
      if (attached) output.printer = printer;

      return { output, calls };
    }

    const headings = [
      {
        line: "###### smallest",
        calls: [
          "small(true)",
          "bold(true)",
          "printLine(smallest)",
          "small(false)",
          "bold(false)",
        ],
      },
      { line: "##### plain", calls: ["printLine(plain)"] },
      {
        line: "#### thin rule",
        calls: ["underline(1)", "printLine(thin rule)", "underline(0)"],
      },
      {
        line: "### thick rule",
        calls: ["underline(6)", "printLine(thick rule)", "underline(0)"],
      },
      { line: "## big", calls: ["big(true)", "printLine(big)", "big(false)"] },
      {
        line: "# biggest",
        calls: [
          "bold(true)",
          "big(true)",
          "printLine(biggest)",
          "bold(false)",
          "big(false)",
        ],
      },
    ];

    for (const heading of headings) {
      it(`renders "${heading.line.split(" ")[0]} " headings`, function () {
        const { output, calls } = thermalPrinter();

        output.processLine(heading.line);

        expect(calls).to.deep.equal(heading.calls);
      });
    }

    it("matches the longest prefix, so ## does not swallow ###", function () {
      const { output, calls } = thermalPrinter();

      output.processLine("### thick rule");

      expect(calls).to.not.include("big(true)");
    });

    it("indents a list item", function () {
      const { output, calls } = thermalPrinter();

      output.processLine("- an item");

      expect(calls).to.deep.equal([
        "small(true)",
        "printLine(  - an item)",
        "small(false)",
      ]);
    });

    it("prints a line at a time, then feeds past the tear bar", async function () {
      const { output, calls } = thermalPrinter();

      await output.send("first\nsecond", "a-trace");

      expect(calls.filter((call) => call === "reset()")).to.have.lengthOf(2);
      expect(calls.at(-2)).to.equal("printLine(\n\n\n)");
      expect(calls.at(-1)).to.equal("print");
    });

    it("stringifies a message that is not already text", async function () {
      const { output, calls } = thermalPrinter();

      await output.send({ a: 1 }, "a-trace");

      expect(calls).to.include('printLine({"a":1})');
    });

    it("traces the error it logs when no printer is attached", async function () {
      const { output, calls } = thermalPrinter({ attached: false });

      expect(await output.send("a receipt", "a-printer-trace")).to.equal(
        "a receipt",
      );
      expect(calls).to.deep.equal([]);

      const [cannotPrint] = linesMatching("Cannot print");
      expect(cannotPrint.verbosity).to.equal("error");
      expect(cannotPrint.traceId).to.equal("a-printer-trace");
    });
  });

  describe("importOptional", function () {
    it("resolves a package that is present", async function () {
      expect(await importOptional("node:path", "a test")).to.have.property(
        "normalize",
      );
    });

    it("names both the package and what needed it", async function () {
      // the entire point of the wrapper: a bare resolution error names neither
      const attempt = importOptional("not-a-real-package", "output:imaginary");

      await expect(attempt).to.be.rejectedWith(/"not-a-real-package"/);
      await expect(attempt).to.be.rejectedWith(/output:imaginary/);
    });
  });

  describe("transform:aggregate", function () {
    async function aggregate(name: string, config: object, message: unknown) {
      const task = new Task(
        { steps: [{ type: "transform:aggregate", ...config } as any] },
        name,
      );
      await task.register();

      return task.startMessage(message as any);
    }

    // For the throw sites the config shapes cannot reach: a basePath always
    // makes message.out an object, and a `path` config always defines
    // context.path, so both are driven through the method directly.
    async function step(config: object) {
      const task = new Task(
        { steps: [{ type: "transform:aggregate", ...config } as any] },
        "aggregates directly",
      );
      await task.register();

      return task.steps[0] as Aggregate;
    }

    it("aggregates a bare array of numbers", async function () {
      expect(
        await aggregate("sums an array", { aggregation: "sum" }, [1, 2, 3]),
      ).to.equal(6);
    });

    it("reads one key out of every reading in an array", async function () {
      expect(
        await aggregate(
          "averages one key",
          { path: "temp", aggregation: "average" },
          [{ temp: 1 }, { temp: 3 }],
        ),
      ).to.deep.equal({ temp: 2 });
    });

    it("aggregates the array a basePath points at", async function () {
      // The result replaces the message rather than merging into it: a
      // basePath starts message.out as an empty object, so "node" is dropped.
      expect(
        await aggregate(
          "averages under a basePath",
          { basePath: "readings", path: "temp", aggregation: "average" },
          { node: "kitchen", readings: [{ temp: 1 }, { temp: 3 }] },
        ),
      ).to.deep.equal({ readings: 2 });
    });

    it("gives each path under a basePath its own aggregation", async function () {
      // One level of "readings", the same as the single-path form; the
      // basePath used to be applied once per path and again on the message.
      expect(
        await aggregate(
          "aggregates two paths",
          {
            basePath: "readings",
            paths: {
              temp: { aggregation: "average" },
              humidity: { aggregation: "sum" },
            },
          },
          {
            node: "kitchen",
            readings: [
              { temp: 1, humidity: 10 },
              { temp: 3, humidity: 20 },
            ],
          },
        ),
      ).to.deep.equal({ readings: { temp: 2, humidity: 30 } });
    });

    it("gives each path its own aggregation without a basePath", async function () {
      expect(
        await aggregate(
          "aggregates two bare paths",
          {
            paths: {
              temp: { aggregation: "average" },
              humidity: { aggregation: "sum" },
            },
          },
          [
            { temp: 1, humidity: 10 },
            { temp: 3, humidity: 20 },
          ],
        ),
      ).to.deep.equal({ temp: 2, humidity: 30 });
    });

    it("refuses an array that is not all numbers", async function () {
      await expect(
        aggregate("sums text", { aggregation: "sum" }, ["a", "b"]),
      ).to.be.rejectedWith(/Expected to find a number array but did not!/);
    });

    it("refuses to write a primitive aggregation onto a non-object", async function () {
      const aggregator = await step({ aggregation: "sum" });

      expect(() =>
        aggregator.transformPrimitiveReadingArray({
          message: { in: [1, 2, 3], out: "not an object" },
          basePath: "readings",
          current: "readings",
        } as Context),
      ).to.throw(/Expected to find an object!/);
    });

    it("refuses a basePath that does not point at an array", async function () {
      await expect(
        aggregate(
          "averages a number",
          { basePath: "readings", path: "temp", aggregation: "average" },
          { readings: 5 },
        ),
      ).to.be.rejectedWith(/Aggregate attempting to operate on non-array value/);
    });

    it("refuses an aggregation with nowhere to write its result", async function () {
      const aggregator = await step({ path: "temp", aggregation: "latest" });

      expect(() =>
        aggregator.transformSimpleReadingArray({
          message: { in: [{ temp: 1 }], out: undefined },
          current: "",
          path: undefined,
        } as Context),
      ).to.throw(/Need either context.current or context.path to be defined./);
    });
  });
});

// trigger:infrared is left out: its virtual path does nothing but set enabled,
// so there is no behavior to assert. trigger:ble-tracker is left out too, but
// only because these tests predate the virtual RSSI reader added in 3256e7a --
// it now has a seam, and a virtual sample is worth covering.
