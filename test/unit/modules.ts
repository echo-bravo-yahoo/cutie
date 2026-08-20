import { describe, it, before, beforeEach } from "node:test";
import { EventEmitter } from "node:events";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { setGlobals } from "../../src/index.js";
import RandomRead from "../../src/reads/random.js";
import BLE from "../../src/reads/ble.js";
import BME680 from "../../src/reads/bme680.js";
import LTR559 from "../../src/reads/ltr559.js";
import MemsMic, { dbfsFrom } from "../../src/reads/mems-mic.js";
import NEC from "../../src/outputs/nec.js";
import Switchbots from "../../src/outputs/switchbots.js";
import ThermalPrinter from "../../src/outputs/thermal-printer.js";
import InkyPhat from "../../src/outputs/inky-phat.js";
import ST7735, { color565, rotateRaster } from "../../src/outputs/st7735.js";
import UnicornHatMini, {
  UnicornPanel,
} from "../../src/outputs/unicorn-hat-mini.js";
import { PIXEL_LUT } from "../../src/util/unicorn-hat-mini-lut.js";
import { importOptional } from "../../src/util/optional-dependency.js";
import { createPigpioClientMock } from "../helpers.js";

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
    addListener(listener: unknown) {
      this.logListeners.push(listener);
    },
    removeListener(listener: unknown) {
      const index = this.logListeners.indexOf(listener);
      if (index !== -1) this.logListeners.splice(index, 1);
    },
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

  describe("read:ble", function () {
    const DEVICES = [
      { address: "00:00:00:00:00:01", label: "phone" },
      { address: "00:00:00:00:00:02", label: "watch" },
    ];

    // Registering a non-virtual read:ble would reach for node-ble, so every
    // test here registers a virtual one.
    async function ble(name: string, config: object = {}) {
      const task = new Task(
        {
          steps: [
            { type: "read:ble", virtual: true, devices: DEVICES, ...config },
          ] as any,
        },
        name,
      );
      await task.register();

      return task.steps[0] as BLE;
    }

    it("reads one entry per configured device without node-ble", async function () {
      const reading = (await (
        await ble("reads every device")
      ).doHandleMessage(undefined, "a-trace")) as any;

      expect(Object.keys(reading.devices)).to.deep.equal(["phone", "watch"]);
      expect(reading.metadata.timestamp).to.be.an.instanceOf(Date);
    });

    it("reports rssi as a number, not a string", async function () {
      const reading = (await (
        await ble("reports numbers")
      ).doHandleMessage(undefined, "a-trace")) as any;

      for (const label of ["phone", "watch"]) {
        expect(reading.devices[label].rssi, label).to.be.a("number");
        expect(reading.devices[label].rssi, label).to.be.within(-95, -40);
      }
    });

    it("leaves out a device it did not see, rather than inventing a floor", async function () {
      const reader = await ble("omits an unseen device");
      // The virtual path always answers, so absence is driven through the real
      // one with an adapter that never turns the second device up.
      reader.config.virtual = false;
      reader.adapter = {
        isDiscovering: async () => true,
        startDiscovery: async () => {},
        waitDevice: async (address: string) => {
          if (address !== DEVICES[0].address) throw new Error("not found");
          return { getRSSI: async () => -63 };
        },
      } as any;

      const reading = (await reader.read(undefined, "a-trace")) as any;

      expect(reading.devices).to.deep.equal({ phone: { rssi: -63 } });
    });

    it("keeps its device handles to itself", async function () {
      const first = await ble("first tracker");
      const second = await ble("second tracker");

      first.devices["00:00:00:00:00:01"] = {} as any;

      expect(second.devices).to.deep.equal({});
      expect(first.devices).to.not.equal(second.devices);
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

    // `virtual` is routed by the Read base class rather than branched on inside
    // read(), so a virtual sample comes from doHandleMessage.
    it("reads a full virtual sample without any hardware", async function () {
      const sample = (await (
        await bme680("reads virtually")
      ).doHandleMessage("ignored", "a-trace")) as any;

      expect(sample.temp).to.be.a("number");
      expect(sample.humidity).to.be.a("number");
      expect(sample.pressure).to.be.a("number");
      expect(sample.gas).to.be.a("number");
      expect(sample.metadata.timestamp).to.be.a("date");
    });

    // A disabled step is left out of the task's chain entirely rather than
    // reached and made to return nothing, so there is no per-read guard left to
    // test here; test/unit/chain.ts covers the chain-level behaviour.
    it("is left out of the chain when it is disabled", async function () {
      const task = new Task(
        {
          steps: [
            { type: "read:bme680", virtual: true, disabled: true } as any,
            { type: "output:console" } as any,
          ],
        },
        "a disabled bme680",
      );
      await task.register();

      expect(task.steps.map((step) => step.config.type)).to.deep.equal([
        "output:console",
      ]);
    });

    it("reports the sensor's gas resistance as gas", async function () {
      const sensor = await bme680("reads a real sample");
      sensor.config.virtual = false;
      // bme680-sensor exposes getSensorData(), not read(), and returns its
      // whole state object with the readings under .data.
      sensor.sensor = {
        getSensorData: async () => ({
          data: {
            temperature: 21.5,
            humidity: 40,
            pressure: 1013,
            gas_resistance: 12345,
          },
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

      await sensor.doHandleMessage("ignored", "a-virtual-trace");
      expect(linesMatching("Sampled new data point")).to.have.lengthOf(0);

      sensor.config.virtual = false;
      sensor.sensor = { getSensorData: async () => ({ data: {} }) };
      await sensor.read("ignored", "a-real-trace");

      const [sampled] = linesMatching("Sampled new data point");
      expect(sampled.traceId).to.equal("a-real-trace");
      expect(sampled.topic).to.equal(sensor.logPrefix);
    });
  });

  describe("read:ltr559", function () {
    // Registering a non-virtual ltr559 would reach for i2c, so every test
    // registers a virtual one and swaps in a fake bus afterwards.
    async function ltr559(name: string) {
      const task = new Task(
        { steps: [{ type: "read:ltr559", virtual: true } as any] },
        name,
      );
      await task.register();

      return task.steps[0] as LTR559;
    }

    function fakeBus(alsBytes: Buffer, psBytes: Buffer) {
      return {
        readI2cBlockSync: (
          _addr: number,
          cmd: number,
          length: number,
          buffer: Buffer,
        ) => {
          (cmd === 0x88 ? alsBytes : psBytes).copy(buffer);
          return length;
        },
        readByteSync: () => 0,
        writeByteSync: () => {},
        closeSync: () => {},
      };
    }

    // `virtual` is routed by the Read base class rather than branched on
    // inside read(), so a virtual sample comes from doHandleMessage.
    it("reads a full virtual sample without any hardware", async function () {
      const sample = (await (
        await ltr559("reads virtually")
      ).doHandleMessage("ignored", "a-trace")) as any;

      expect(sample.lux).to.be.a("number");
      expect(sample.proximity).to.be.a("number");
      expect(sample.metadata.timestamp).to.be.a("date");
    });

    // A disabled step is left out of the task's chain entirely rather than
    // reached and made to return nothing, so there is no per-read guard left
    // to test here; test/unit/chain.ts covers the chain-level behaviour.
    it("is left out of the chain when it is disabled", async function () {
      const task = new Task(
        {
          steps: [
            { type: "read:ltr559", virtual: true, disabled: true } as any,
            { type: "output:console" } as any,
          ],
        },
        "a disabled ltr559",
      );
      await task.register();

      expect(task.steps.map((step) => step.config.type)).to.deep.equal([
        "output:console",
      ]);
    });

    it("computes lux from the ALS channel bytes", async function () {
      const sensor = await ltr559("computes lux");
      sensor.config.virtual = false;

      // ALS_DATA is ch1 lo/hi then ch0 lo/hi, little-endian: ch1=100, ch0=300.
      sensor.bus = fakeBus(
        Buffer.from([0x64, 0x00, 0x2c, 0x01]),
        Buffer.from([0x00, 0x00]),
      ) as any;

      const sample = (await sensor.read("ignored", "a-trace")) as any;

      // ratio = ch1*100/(ch0+ch1) = 25 -> band 0, coefficients 17743/-11059.
      // lux = (300*17743 - 100*-11059) / 0.5 / 4 / 10000 = 321.44
      expect(sample.lux).to.be.closeTo(321.44, 0.01);
    });

    it("computes an 11-bit proximity value from the PS channel bytes", async function () {
      const sensor = await ltr559("computes proximity");
      sensor.config.virtual = false;

      // low byte 0xFF, high byte's low 3 bits 0x03 -> 0xFF | (0x03 << 8) = 1023
      sensor.bus = fakeBus(
        Buffer.from([0, 0, 0, 0]),
        Buffer.from([0xff, 0x03]),
      ) as any;

      const sample = (await sensor.read("ignored", "a-trace")) as any;

      expect(sample.proximity).to.equal(1023);
    });
  });

  describe("read:mems-mic", function () {
    async function memsMic(name: string, config: object = {}) {
      const task = new Task(
        {
          steps: [
            {
              type: "read:mems-mic",
              virtual: true,
              alsaDevice: "plughw:CARD=test,DEV=0",
              ...config,
            } as any,
          ],
        },
        name,
      );
      await task.register();

      return task.steps[0] as MemsMic;
    }

    // A WAV header's exact bytes never matter to dbfsFrom(): it only skips a
    // fixed 44-byte offset before reading 16-bit LE PCM samples.
    function wavFixture(samples: Array<number>) {
      const buffer = Buffer.alloc(44 + samples.length * 2);
      samples.forEach((sample, index) =>
        buffer.writeInt16LE(sample, 44 + index * 2),
      );
      return buffer;
    }

    // `virtual` is routed by the Read base class rather than branched on
    // inside read(), so a virtual sample comes from doHandleMessage.
    it("reads a full virtual sample without any hardware", async function () {
      const sample = (await (
        await memsMic("reads virtually")
      ).doHandleMessage("ignored", "a-trace")) as any;

      expect(sample.soundLevel).to.be.a("number");
      expect(sample.metadata.timestamp).to.be.a("date");
    });

    // A disabled step is left out of the task's chain entirely rather than
    // reached and made to halt, so there is no per-read guard left to test
    // here; test/unit/chain.ts covers the chain-level behaviour.
    it("is left out of the chain when it is disabled", async function () {
      const task = new Task(
        {
          steps: [
            {
              type: "read:mems-mic",
              virtual: true,
              alsaDevice: "plughw:CARD=test,DEV=0",
              disabled: true,
            } as any,
            { type: "output:console" } as any,
          ],
        },
        "a disabled mems-mic",
      );
      await task.register();

      expect(task.steps.map((step) => step.config.type)).to.deep.equal([
        "output:console",
      ]);
    });

    it("throws when the capture fails, and leaves no capture file behind", async function () {
      const sensor = await memsMic("capture fails", {
        virtual: false,
        alsaDevice: "not-a-real-device",
      });

      // Containing the failure is the runtime's job rather than this module's:
      // the trigger keeps the node up, and a `rescue` decides what a skipped
      // reading becomes.
      await expect(sensor.read("ignored", "a-trace")).to.be.rejected;

      const leftovers = (await readdir(tmpdir())).filter((entry) =>
        entry.startsWith("cutie-mems-mic-"),
      );
      expect(leftovers).to.deep.equal([]);
    });

    it("computes dBFS as 20*log10(rms / full scale)", function () {
      // A constant amplitude at half of full scale: rms equals the amplitude
      // itself, so the expected value is exact rather than approximate.
      expect(
        dbfsFrom(wavFixture([16384, -16384, 16384, -16384])),
      ).to.be.closeTo(-6.0206, 0.001);
    });

    it("reports silence as negative infinity rather than throwing", function () {
      expect(dbfsFrom(wavFixture([0, 0, 0, 0]))).to.equal(-Infinity);
    });

    it("reports the loudest representable samples at ~0 dBFS", function () {
      // 32767 is the ceiling of a signed 16-bit sample; 32768 would overflow.
      expect(dbfsFrom(wavFixture([32767, -32767]))).to.be.closeTo(0, 0.001);
    });
  });

  describe("output:switchbots", function () {
    function switchbots(devices: Array<object>, { discovered = true } = {}) {
      const task = new Task({ steps: [] }, "drives a switchbot");
      const output = new Switchbots(
        { type: "output:switchbots", devices } as any,
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
      const { output, calls } = switchbots([{ address: "bot-1" }]);

      await output.send({ id: "bot-1", action: "press" }, "a-trace");

      expect(calls).to.deep.equal(["press"]);
    });

    it("lowers the arm to turn a normally-mounted bot on", async function () {
      const { output, calls } = switchbots([{ address: "bot-1" }]);

      await output.send({ id: "bot-1", action: "on" }, "a-trace");
      await output.send({ id: "bot-1", action: "off" }, "a-trace");

      expect(calls).to.deep.equal(["handDown", "handUp"]);
    });

    it("inverts the arm for a reverse-mounted bot", async function () {
      const { output, calls } = switchbots([
        { address: "bot-1", reverseOnOff: true },
      ]);

      await output.send({ id: "bot-1", action: "on" }, "a-trace");
      await output.send({ id: "bot-1", action: "off" }, "a-trace");

      expect(calls).to.deep.equal(["handUp", "handDown"]);
    });

    it("reports a request that names no bot or no action", async function () {
      const { output } = switchbots([{ address: "bot-1" }]);

      await expect(output.send({ action: "on" }, "a-trace")).to.be.rejectedWith(
        /\{"action":"on"\}/,
      );
      await expect(output.send({ id: "bot-1" }, "a-trace")).to.be.rejectedWith(
        /\{"id":"bot-1"\}/,
      );
    });

    // A message still names a device by `id`; it is the config that renamed its
    // key to `address`, so that the label a bot carries stops colliding with the
    // `name` every step accepts.
    it("lists the bots it knows when asked for one it does not", async function () {
      const { output } = switchbots([{ address: "bot-1" }]);

      await expect(
        output.send({ id: "bot-9", action: "on" }, "a-trace"),
      ).to.be.rejectedWith(/known addresses are \["bot-1"\]/);
    });

    it("says when a configured bot was never discovered", async function () {
      const { output } = switchbots(
        [{ address: "bot-1", label: "kitchen light" }],
        {
          discovered: false,
        },
      );

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
      const { calls, pigpioClient } = createPigpioClientMock();
      output.pigpioClient = pigpioClient;

      const message = { address: "0x7c", command: "0x66" };
      expect(await output.send(message, "a-trace")).to.equal(message);
      expect(calls).to.deep.equal([]);
    });

    it("transmits exactly once when it has a pigpioClient", async function () {
      const output = nec();
      const { calls, pigpioClient } = createPigpioClientMock();
      output.pigpioClient = pigpioClient;

      const message = { address: "0x7c", command: "0x66" };
      expect(await output.send(message, "a-trace")).to.equal(message);
      expect(calls.filter((call) => call === "waveCreate")).to.have.lengthOf(1);
    });

    it("transmits nothing when there is no pigpioClient to transmit with", async function () {
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

  describe("output:unicorn-hat-mini", function () {
    const ROWS = 7;
    const COLS = 17;
    const BITMAP_BYTES = ROWS * COLS * 3;

    // A panel that has never been opened holds no spidev handles, so show() has
    // nothing to write to and the buffer can be inspected with no hardware
    // anywhere. Only the vendored lookup table decides where a pixel lands.
    function attached() {
      const task = new Task({ steps: [] }, "draws on a unicorn hat mini");
      const output = new UnicornHatMini(
        {
          type: "output:unicorn-hat-mini",
          source: "bitmap",
          path: "frame",
        } as any,
        task,
      );
      const panel = new UnicornPanel();

      output.panel = panel;
      output.enabled = true;

      return { output, panel, buffer: (panel as any).buffer as Array<number> };
    }

    async function virtual(name: string, config: object = {}) {
      const task = new Task(
        {
          steps: [
            {
              type: "output:unicorn-hat-mini",
              source: "bitmap",
              path: "frame",
              virtual: true,
              ...config,
            } as any,
          ],
        },
        name,
      );
      await task.register();

      return task.steps[0] as UnicornHatMini;
    }

    // Columns 0-8 are wired to the first HT16D35A and 9-16 to the second, so
    // (3, 8) and (3, 9) sit either side of the chip boundary.
    //
    // The rest are chosen to tell a column-major read from a row-major one,
    // which most coordinates cannot: col * ROWS + row and row * COLS + col
    // agree at (0, 0), (3, 8) and (6, 16), so a spread made only of corners
    // would pass under either reading.
    const spread: Array<[number, number]> = [
      [0, 0],
      [6, 0],
      [0, 16],
      [3, 8],
      [3, 9],
      [6, 16],
    ];

    for (const [row, col] of spread) {
      it(`writes row ${row}, column ${col} where the lookup table says`, function () {
        const { panel, buffer } = attached();

        panel.setPixel(row, col, [11, 22, 33]);

        // Column-major: the stride is ROWS, and reading the table row-major
        // instead scatters the image rather than obviously breaking it.
        const [red, green, blue] = PIXEL_LUT[col * ROWS + row];
        expect([buffer[red], buffer[green], buffer[blue]]).to.deep.equal([
          11, 22, 33,
        ]);
      });
    }

    it("ignores a pixel outside the panel rather than corrupting the buffer", function () {
      const { panel, buffer } = attached();
      const before = [...buffer];

      panel.setPixel(0, COLS, [255, 255, 255]);
      panel.setPixel(-1, 0, [255, 255, 255]);
      // A row of ROWS is the interesting one: it lands on a real table entry -
      // the next column's first pixel - so only bounding the row catches it.
      panel.setPixel(ROWS, 0, [255, 255, 255]);

      expect(buffer).to.deep.equal(before);
    });

    it("lands a bitmap's pixels three bytes at a time, row-major", async function () {
      const { output, panel, buffer } = attached();

      // One lit pixel, at a row and column that cannot be confused for each
      // other: transposing it would put it off the panel entirely.
      const frame = new Array(BITMAP_BYTES).fill(0);
      const at = (3 * COLS + 9) * 3;
      frame[at] = 10;
      frame[at + 1] = 20;
      frame[at + 2] = 30;

      await output.send({ frame }, "a-trace");

      const [red, green, blue] = PIXEL_LUT[9 * ROWS + 3];
      expect([buffer[red], buffer[green], buffer[blue]]).to.deep.equal([
        10, 20, 30,
      ]);
      expect(buffer.filter((value) => value !== 0)).to.have.lengthOf(3);
      expect(panel).to.equal(output.panel);
    });

    it("refuses a bitmap that is not exactly the panel's size", async function () {
      const { output } = attached();

      await expect(
        output.send({ frame: [1, 2, 3] }, "a-trace"),
      ).to.be.rejectedWith(/bitmap of 357 bytes, but got 3/);
    });

    it("logs what it would draw, and touches no panel, when virtual", async function () {
      const output = await virtual("draws virtually");
      const frame = new Array(BITMAP_BYTES).fill(0);
      // Two pixels, lit through different channels: any channel counts.
      frame[0] = 255;
      frame[5] = 255;
      const message = { frame };

      expect(await output.send(message, "a-trace")).to.equal(message);
      expect(output.panel).to.equal(undefined);

      const [drawn] = linesMatching("Would draw (virtual)");
      expect(drawn.log).to.include("17x7, 2 lit pixels");
      expect(drawn.traceId).to.equal("a-trace");
    });
  });

  describe("output:inky-phat", function () {
    const WIDTH = 212;
    const HEIGHT = 104;
    const PIXELS = WIDTH * HEIGHT;

    function inkyPhat(config: object = {}) {
      const task = new Task({ steps: [] }, "draws on an inky phat");

      return new InkyPhat(
        {
          type: "output:inky-phat",
          source: "bitmap",
          path: "frame",
          virtual: true,
          ...config,
        } as any,
        task,
      );
    }

    async function virtual(name: string, config: object = {}) {
      const task = new Task(
        {
          steps: [
            {
              type: "output:inky-phat",
              source: "bitmap",
              path: "frame",
              virtual: true,
              ...config,
            } as any,
          ],
        },
        name,
      );
      await task.register();

      return task.steps[0] as InkyPhat;
    }

    it("quantises against the third colour the panel actually shows", function () {
      // The variants are indistinguishable in software, so this is config's
      // only say in the matter - and a photograph reduced against red on a
      // yellow panel picks the wrong pixels, not merely the wrong shade.
      expect(inkyPhat({ panelColor: "yellow" }).palette).to.deep.equal([
        [255, 255, 255],
        [0, 0, 0],
        [255, 255, 0],
      ]);
      expect(inkyPhat({ panelColor: "red" }).palette).to.deep.equal([
        [255, 255, 255],
        [0, 0, 0],
        [255, 0, 0],
      ]);
      expect(inkyPhat({ panelColor: "black" }).palette).to.have.lengthOf(2);
    });

    it("refuses a bitmap holding an index the panel has no colour for", async function () {
      const output = await virtual("refuses a stray index");
      const frame = new Array(PIXELS).fill(0);
      frame[7] = 4;

      await expect(output.send({ frame }, "a-trace")).to.be.rejectedWith(
        /4 palette entries, but the bitmap holds 4 at index 7/,
      );
    });

    it("refuses a bitmap that is not exactly the panel's size", async function () {
      const output = await virtual("refuses a short bitmap");

      await expect(
        output.send({ frame: [0, 1, 2] }, "a-trace"),
      ).to.be.rejectedWith(/bitmap of 22048 bytes, but got 3/);
    });

    it("skips a message that arrives before the panel may be redrawn", async function (context) {
      context.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
      const output = await virtual("paces its refreshes", {
        minRefreshMs: 60_000,
      });
      const frame = new Array(PIXELS).fill(0);

      await output.send({ frame }, "first");
      context.mock.timers.tick(30_000);
      await output.send({ frame }, "second");

      expect(linesMatching("Would draw (virtual)")).to.have.lengthOf(1);
      const [skipped] = linesMatching("Skipping refresh");
      expect(skipped.traceId).to.equal("second");
    });

    it("redraws once the refresh interval has passed", async function (context) {
      context.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
      const output = await virtual("redraws after its interval", {
        minRefreshMs: 60_000,
      });
      const frame = new Array(PIXELS).fill(0);

      await output.send({ frame }, "first");
      context.mock.timers.tick(60_000);
      await output.send({ frame }, "second");

      expect(linesMatching("Would draw (virtual)")).to.have.lengthOf(2);
      expect(linesMatching("Skipping refresh")).to.have.lengthOf(0);
    });

    it("logs the palette histogram of what it would draw when virtual", async function () {
      const output = await virtual("draws virtually", { panelColor: "yellow" });
      const frame = new Array(PIXELS).fill(0);
      for (let at = 0; at < 500; at += 1) frame[at] = 2;
      frame[600] = 1;
      const message = { frame };

      expect(await output.send(message, "a-trace")).to.equal(message);

      const [drawn] = linesMatching("Would draw (virtual)");
      expect(drawn.log).to.include("212x104, 21547 white, 1 black, 500 yellow");
      expect(drawn.traceId).to.equal("a-trace");
    });

    it("refuses a config that names both a file and a path", function () {
      expect(() => inkyPhat({ file: "/var/lib/cutie/frame.png" })).to.throw(
        /takes either a file or a path, not both/,
      );
    });
  });

  describe("output:st7735", function () {
    async function virtual(name: string, config: object = {}) {
      const task = new Task(
        {
          steps: [
            {
              type: "output:st7735",
              source: "bitmap",
              path: "frame",
              virtual: true,
              spiDevice: "/dev/spidev0.1",
              dcPin: 9,
              backlightPin: 12,
              ...config,
            } as any,
          ],
        },
        name,
      );
      await task.register();

      return task.steps[0] as ST7735;
    }

    it("converts known colours to their known RGB565 values", function () {
      expect(color565(255, 255, 255)).to.equal(0xffff);
      expect(color565(0, 0, 0)).to.equal(0x0000);
      expect(color565(255, 0, 0)).to.equal(0xf800);
      expect(color565(0, 255, 0)).to.equal(0x07e0);
      expect(color565(0, 0, 255)).to.equal(0x001f);
    });

    it("leaves an unrotated raster untouched", function () {
      const raster = {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
      };

      expect(rotateRaster(raster as any, 0)).to.equal(raster);
    });

    it("rotates a raster 90 degrees, swapping its dimensions", function () {
      // A 2-wide, 1-tall raster with distinct pixels, so a transposition or a
      // wrong rotation direction shows up as the wrong pixel in the wrong
      // place rather than a coincidentally-correct symmetric result.
      const raster = {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([
          10,
          0,
          0,
          255, // left pixel, red channel 10
          0,
          20,
          0,
          255, // right pixel, green channel 20
        ]),
      };

      const rotated = rotateRaster(raster as any, 90);

      expect(rotated.width).to.equal(1);
      expect(rotated.height).to.equal(2);
      // 90 degrees counterclockwise: the right pixel ends up on top.
      expect([...rotated.data.slice(0, 4)]).to.deep.equal([0, 20, 0, 255]);
      expect([...rotated.data.slice(4, 8)]).to.deep.equal([10, 0, 0, 255]);
    });

    it("logs what it would draw, and touches no panel, when virtual", async function () {
      const output = await virtual("draws virtually", {
        width: 4,
        height: 2,
      });
      const frame = new Array(4 * 2 * 3).fill(0);
      // Two lit pixels, through different channels: any channel counts.
      frame[0] = 255;
      frame[5] = 255;
      const message = { frame };

      expect(await output.send(message, "a-trace")).to.equal(message);
      expect(output.panel).to.equal(undefined);

      const [drawn] = linesMatching("Would draw (virtual)");
      expect(drawn.log).to.include("4x2, 2 lit pixels");
      expect(drawn.traceId).to.equal("a-trace");
    });

    it("refuses a bitmap that is not exactly the panel's size", async function () {
      const output = await virtual("refuses a short bitmap", {
        width: 4,
        height: 2,
      });

      await expect(
        output.send({ frame: [1, 2, 3] }, "a-trace"),
      ).to.be.rejectedWith(/bitmap of 24 bytes, but got 3/);
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

    it("refuses a basePath that does not point at an array", async function () {
      await expect(
        aggregate(
          "averages a number",
          { basePath: "readings", path: "temp", aggregation: "average" },
          { readings: 5 },
        ),
        // The Transform base class checks basePath before any walker runs, so
        // the message names the path and what was found there.
      ).to.be.rejectedWith(
        /"basePath" "readings" should point at an array, but found a number/,
      );
    });
  });
});

// trigger:infrared is left out: its virtual path does nothing but set enabled,
// so there is no behavior to assert.
