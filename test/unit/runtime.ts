import { describe, it, afterEach, before, mock, Mock } from "node:test";
import { EventEmitter } from "node:events";
import * as realFsPromises from "node:fs/promises";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { globals, setGlobals } from "../../src/index.js";
import { doAggregation } from "../../src/util/aggregation.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import { registerConnections } from "../../src/util/connections.js";
import { Connection } from "../../src/util/Connection.js";
import { redact } from "../../src/util/redact.js";
import { CronConfig } from "../../src/triggers/cron.js";
import { EventConfig } from "../../src/triggers/event.js";
import {
  isConnection,
  isOutput,
  isRead,
  isTransform,
  isTrigger,
  KINDS,
} from "../../src/util/type-helpers.js";
import { Configurable } from "../../src/util/Configurable.js";
import LogHelper from "../../src/util/LogHelper.js";
import { validateConfig } from "../../src/util/validate.js";
import NEC from "../../src/outputs/nec.js";
import Switchbots from "../../src/outputs/switchbots.js";
import ThermalPrinter from "../../src/outputs/thermal-printer.js";
import InfluxDB from "../../src/outputs/influxdb.js";
import InfluxDBConnection from "../../src/connections/influxdb.js";
import {
  necToBits,
  necToWave,
  transmitNECCommand,
} from "../../src/util/bitbang/adapters/nec.js";
import { createPigpioMock, MOCK_WAVE_ID, taskDone } from "../helpers.js";

// A connection with a stubbed-out client, so subscribe/unsubscribe
// bookkeeping can be observed without a broker.
function stubbedConnection() {
  const connection = new MQTTConnection({
    type: "connection:mqtt",
    name: "stub",
    endpoint: "mqtt://127.0.0.1:1883",
  } as any);
  const subscribed: Array<Array<string>> = [];
  const unsubscribed: Array<Array<string>> = [];

  connection.connection = {
    options: { clientId: "stub_client" },
    subscribeAsync: async (topics: Array<string>) => subscribed.push(topics),
    unsubscribeAsync: async (topics: Array<string>) =>
      unsubscribed.push(topics),
  } as any;
  connection.enabled = true;

  return { connection, subscribed, unsubscribed };
}

describe("the runtime", function () {
  // output:file is the only module here that writes anything, so its two
  // calls are faked file-wide; everything else in node:fs/promises is real.
  const appendFile = mock.fn(async () => {}) as unknown as Mock<
    typeof realFsPromises.appendFile
  >;
  const writeFile = mock.fn(async () => {}) as unknown as Mock<
    typeof realFsPromises.writeFile
  >;

  const fakeLogger = {
    logListeners: [] as Array<unknown>,
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  before(() => {
    // has to be installed before any test imports output:file, which the
    // declared-defaults tests do
    mock.module("node:fs/promises", {
      namedExports: { ...realFsPromises, appendFile, writeFile },
    });

    setGlobals({
      logger: fakeLogger,
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as any);
  });

  describe("kind predicates", function () {
    async function stepOfKind(type: string) {
      const task = new Task({ steps: [{ type }] }, `predicate ${type}`);
      return task.importStep({ type });
    }

    const predicates = {
      trigger: isTrigger,
      read: isRead,
      transform: isTransform,
      output: isOutput,
      connection: isConnection,
    };

    const representative: Record<string, string> = {
      trigger: "trigger:once",
      read: "read:constant",
      transform: "transform:prettify",
      output: "output:console",
      connection: "connection:influxdb",
    };

    for (const kind of KINDS) {
      it(`identifies ${kind} and rejects the other kinds`, async function () {
        const instance =
          kind === "connection"
            ? new MQTTConnection({
                type: "connection:mqtt",
                name: "predicate",
                endpoint: "mqtt://127.0.0.1:1883",
              } as any)
            : ((await stepOfKind(representative[kind])) as Configurable);

        for (const other of KINDS) {
          expect(
            predicates[other](instance),
            `is${other} on a ${kind}`,
          ).to.equal(other === kind);
        }
      });
    }
  });

  describe("a disabled task", function () {
    it("leaves every kind of step disabled", async function () {
      const task = new Task(
        {
          disabled: true,
          trigger: { type: "trigger:once", message: "hi" } as any,
          steps: [
            { type: "read:constant", value: "a value" } as any,
            { type: "transform:prettify" } as any,
            { type: "output:console" } as any,
          ],
        },
        "a disabled task",
      );

      await task.register();

      expect(task.trigger!.enabled, "trigger").to.equal(false);
      for (const step of task.steps) {
        expect(step.enabled, step.config.type).to.equal(false);
      }
    });
  });

  describe("trigger:logs", function () {
    it("does not listen while its task is disabled", async function () {
      const task = new Task(
        {
          disabled: true,
          trigger: { type: "trigger:logs", filters: ["*"] } as any,
          steps: [{ type: "output:stash", key: "line", value: "x" } as any],
        },
        "a disabled logs task",
      );

      await task.register();

      expect(globals.logger.logListeners).to.not.include(task.trigger);
    });

    // Driven by a real LogHelper rather than the no-op fake the rest of this
    // file uses: the fake never dispatches, which is how the re-entrancy defect
    // stayed hidden. See test/unit/logging.ts for the rest of that coverage.
    it("listens once enabled and stops again when disabled", async function () {
      const realLogger = new LogHelper();
      realLogger.logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
      } as any;
      const previousLogger = globals.logger;
      globals.logger = realLogger;

      try {
        const task = new Task(
          {
            trigger: {
              type: "trigger:logs",
              filters: ["core.test"],
              minVerbosity: "trace",
            } as any,
            steps: [{ type: "output:stash", key: "line", value: "x" } as any],
          },
          "an enabled logs task",
        );

        await task.register();
        expect(realLogger.logListeners).to.include(task.trigger);

        realLogger.emit("a line", "info", "core.test");
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(task.messagesHandled).to.equal(1);

        await task.trigger!.disable();
        expect(realLogger.logListeners).to.not.include(task.trigger);

        realLogger.emit("another line", "info", "core.test");
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(task.messagesHandled).to.equal(1);
      } finally {
        globals.logger = previousLogger;
      }
    });
  });

  describe("declared config defaults", function () {
    async function configOf(type: string, extra: object = {}) {
      const task = new Task(
        { steps: [{ type, ...extra } as any] },
        `defaults ${type}`,
      );
      const step = await task.importStep({ type, ...extra } as any);

      return step.config;
    }

    it("applies output:file's append and insertNewlines", async function () {
      const config = await configOf("output:file", { path: "/tmp/x" });

      expect(config.append).to.equal(true);
      expect(config.insertNewlines).to.equal(true);
    });

    it("applies transform:uglify's parseInput", async function () {
      expect((await configOf("transform:uglify")).parseInput).to.equal(false);
    });

    it("applies trigger:once's delay", async function () {
      expect((await configOf("trigger:once")).delay).to.equal(0);
    });

    it("still lets an explicit value win over a default", async function () {
      const config = await configOf("output:file", {
        path: "/tmp/x",
        append: false,
      });

      expect(config.append).to.equal(false);
    });
  });

  describe("read:constant", function () {
    async function readConstant(value: unknown, message: unknown = "incoming") {
      const task = new Task(
        {
          steps: [
            { type: "read:constant", value } as any,
            { type: "output:stash", key: "read", value: "${message}" } as any,
          ],
        },
        "reads a constant",
      );
      await task.register();

      return task.steps[0].handleMessage(message as any, "trace");
    }

    it("returns a number rather than passing the message through", async function () {
      expect(await readConstant(42)).to.equal(42);
    });

    it("returns an object rather than passing the message through", async function () {
      expect(await readConstant({ a: 1 })).to.deep.equal({ a: 1 });
    });

    it("still interpolates a string value", async function () {
      expect(await readConstant("saw ${message}", "a thing")).to.equal(
        "saw a thing",
      );
    });

    it("interpolates strings nested inside an object value", async function () {
      expect(
        await readConstant({ seen: "${message}" }, "a thing"),
      ).to.deep.equal({ seen: "a thing" });
    });
  });

  describe("read:stash", function () {
    it("returns the stashed value, not the key", async function () {
      const task = new Task(
        {
          steps: [
            { type: "output:stash", key: "fname", value: "notes.txt" } as any,
            { type: "read:stash", key: "fname" } as any,
          ],
        },
        "reads from the stash",
      );
      await task.register();

      expect(await task.startMessage("anything")).to.equal("notes.txt");
    });

    it("resolves undefined for a key that was never stashed", async function () {
      const task = new Task(
        { steps: [{ type: "read:stash", key: "missing" } as any] },
        "reads a missing stash key",
      );
      await task.register();

      expect(await task.startMessage("anything")).to.equal(undefined);
    });
  });

  describe("transform:accumulate", function () {
    it("settles every message chain, not just the one completing a batch", async function () {
      const task = new Task(
        {
          steps: [
            { type: "transform:accumulate", count: 5 } as any,
            { type: "output:stash", key: "batch", value: "${message}" } as any,
          ],
        },
        "accumulates five",
      );
      await task.register();

      const chains = [1, 2, 3, 4, 5].map((n) => task.startMessage(n));
      const settled = await Promise.all(chains);

      // the first four are halted, the fifth carries the whole batch
      expect(settled.slice(0, 4)).to.deep.equal([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(settled[4]).to.deep.equal([1, 2, 3, 4, 5]);
    });
  });

  describe("output:logs", function () {
    async function logWith(verbosity: unknown) {
      const task = new Task(
        { steps: [{ type: "output:logs" } as any] },
        "logs a line",
      );
      await task.register();

      return task.startMessage({ log: "a line", verbosity } as any);
    }

    it("survives a missing verbosity", async function () {
      await logWith(undefined);
    });

    it("survives a misspelled verbosity", async function () {
      await logWith("infoo");
    });

    it("accepts a known verbosity", async function () {
      await logWith("warn");
    });
  });

  describe("trigger:cron", function () {
    it("fires more than once", async function () {
      const task = new Task(
        {
          steps: [{ type: "output:stash", key: "last", value: "tick" } as any],
          trigger: {
            type: "trigger:cron",
            // once per second, so the repeat is observable in a unit test
            expression: "* * * * * *",
            message: "tick",
          } as CronConfig,
        },
        "cron fires more than once",
      );

      await task.register();
      await taskDone(task, { timeout: 4000, waitFor: 2 });
      await task.trigger!.disable();

      expect(task.messagesHandled).to.be.at.least(2);
    });
  });

  describe("trigger:event", function () {
    it("stops listening when disabled", async function () {
      const task = new Task(
        {
          steps: [{ type: "output:stash", key: "last", value: "fired" } as any],
          trigger: {
            type: "trigger:event",
            key: "a-happening",
          } as EventConfig,
        },
        "event unsubscribes on disable",
      );

      await task.register();
      expect(globals.eventBus.listenerCount("a-happening")).to.equal(1);

      await task.trigger!.disable();
      expect(globals.eventBus.listenerCount("a-happening")).to.equal(0);
    });
  });

  describe("MQTTConnection.matchesTopic", function () {
    it("matches a single wildcard filter given as a string", function () {
      expect(
        MQTTConnection.matchesTopic("development/thing", "development/+"),
      ).to.equal(true);
    });

    it("matches a wildcard filter given in an array", function () {
      expect(
        MQTTConnection.matchesTopic("development/thing", [
          "unrelated/+",
          "development/+",
        ]),
      ).to.equal(true);
    });

    it("matches a multi-level wildcard", function () {
      expect(MQTTConnection.matchesTopic("a/b/c/d", "a/#")).to.equal(true);
    });

    it("does not match an unrelated filter", function () {
      expect(
        MQTTConnection.matchesTopic("development/thing", "prod/+"),
      ).to.equal(false);
    });
  });

  describe("MQTTConnection.sendRaw", function () {
    it("does not throw when the client never connected", function () {
      const connection = new MQTTConnection({
        type: "connection:mqtt",
        name: "stub",
        endpoint: "mqtt://127.0.0.1:1883",
      } as any);

      expect(() => connection.sendRaw("some/topic", "hello")).to.not.throw();
    });
  });

  describe("MQTT topic subscriptions", function () {
    it("only unsubscribes once the last subscriber goes away", async function () {
      const { connection, subscribed, unsubscribed } = stubbedConnection();

      await connection.subscribe("shared/topic");
      await connection.subscribe("shared/topic");
      expect(subscribed).to.deep.equal([["shared/topic"]]);

      await connection.unsubscribe("shared/topic");
      expect(unsubscribed).to.deep.equal([]);

      await connection.unsubscribe("shared/topic");
      expect(unsubscribed).to.deep.equal([["shared/topic"]]);
    });

    it("subscribes each distinct topic once", async function () {
      const { connection, subscribed } = stubbedConnection();

      await connection.subscribe(["a/one", "a/two"]);
      await connection.subscribe(["a/two", "a/three"]);

      expect(subscribed).to.deep.equal([["a/one", "a/two"], ["a/three"]]);
    });
  });

  describe("a non-JSON MQTT payload", function () {
    // Sets up one enabled mqtt trigger against a stubbed connection, so
    // handleMessage can be driven directly with an arbitrary payload.
    async function deliver(payload: string) {
      const { connection } = stubbedConnection();
      connection.name = "stub";
      globals.connections.push(connection);

      const task = new Task(
        {
          trigger: {
            type: "trigger:mqtt",
            connectionName: "stub",
            topics: ["some/topic"],
          } as any,
          steps: [],
        },
        "receives an mqtt message",
      );
      await task.register();
      globals.tasks.push(task);

      // endMessage sees the message exactly as the connection decoded it,
      // which output:stash would stringify
      const received: Array<unknown> = [];
      task.endMessage = async (message: any) => {
        received.push(message);
        return message;
      };

      try {
        connection.handleMessage("some/topic", Buffer.from(payload), {} as any);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(received).to.have.lengthOf(1);
        return received[0];
      } finally {
        globals.tasks.length = 0;
        globals.connections.length = 0;
      }
    }

    it("passes unparseable text through instead of throwing", async function () {
      expect(await deliver("not json at all")).to.equal("not json at all");
    });

    it("still parses a JSON payload", async function () {
      expect(await deliver(JSON.stringify({ a: 1 }))).to.deep.equal({ a: 1 });
    });

    it("passes a bare number through as JSON", async function () {
      expect(await deliver("42")).to.equal(42);
    });
  });

  // The four ported v3 modules drive physical hardware; virtual mode is
  // exercised here, and everything else needs a Pi.
  describe("output:nec", function () {
    it("reads a hex string with or without an 0x prefix", function () {
      expect(NEC.toNumber("0x7c")).to.equal(0x7c);
      expect(NEC.toNumber("7c")).to.equal(0x7c);
    });

    it("passes a number through", function () {
      expect(NEC.toNumber(124)).to.equal(124);
    });

    it("leaves an absent value absent", function () {
      expect(NEC.toNumber(undefined)).to.equal(undefined);
    });

    it("rejects a string that is not hexadecimal", function () {
      expect(() => NEC.toNumber("zz")).to.throw(/hexadecimal/);
    });

    it("resolves a saved command by id", async function () {
      const task = new Task({ steps: [] }, "nec saved command");
      const nec = new NEC(
        {
          type: "output:nec",
          virtual: true,
          savedCommands: {
            volumeDown: { address: "0x7c", command: "0x66" },
          },
        } as any,
        task,
      );

      expect(nec.resolveCommand({ id: "volumeDown" })).to.deep.equal({
        address: 0x7c,
        command: 0x66,
        extendedAddress: undefined,
        extendedCommand: undefined,
      });
    });

    it("reports an unknown saved command by name", async function () {
      const task = new Task({ steps: [] }, "nec unknown command");
      const nec = new NEC(
        { type: "output:nec", virtual: true, savedCommands: {} } as any,
        task,
      );

      expect(() => nec.resolveCommand({ id: "nope" })).to.throw(/"nope"/);
    });

    // There is no default: a GPIO pin number is a fact about someone's wiring,
    // and guessing 23 silently drove the wrong pin.
    it("requires the LED pin rather than guessing one", async function () {
      await expect(
        new Task(
          { steps: [{ type: "output:nec" } as never] },
          "nec without a pin",
        ).register(),
      ).to.be.rejectedWith(/needs a "ledPin"/);
    });

    it("wants no LED pin when it is virtual", async function () {
      const errors = await validateConfig(
        { tasks: { t: { steps: [{ type: "output:nec", virtual: true }] } } },
        { configPath: "/tmp/x.json" },
      );

      expect(errors).to.deep.equal([]);
    });
  });

  describe("output:switchbots", function () {
    it("lowers the arm to turn a normally-mounted bot on", function () {
      expect(Switchbots.toHandMotion(true, false)).to.equal("handDown");
      expect(Switchbots.toHandMotion(false, false)).to.equal("handUp");
    });

    it("inverts the motion for a reverse-mounted bot", function () {
      expect(Switchbots.toHandMotion(true, true)).to.equal("handUp");
      expect(Switchbots.toHandMotion(false, true)).to.equal("handDown");
    });

    it("skips the device call and returns the message when virtual", async function () {
      const task = new Task({ steps: [] }, "virtual switchbot");
      const bot = new Switchbots(
        {
          type: "output:switchbots",
          virtual: true,
          devices: [{ address: "abc123", label: "kitchen light" }],
        } as any,
        task,
      );

      const result = await bot.send(
        { id: "abc123", action: "on" } as any,
        "a-trace",
      );
      expect(result).to.deep.equal({ id: "abc123", action: "on" });
    });
  });

  describe("output:thermal-printer", function () {
    it("logs instead of printing and returns the message when virtual", async function () {
      const task = new Task({ steps: [] }, "virtual thermal printer");
      const printer = new ThermalPrinter(
        { type: "output:thermal-printer", virtual: true } as any,
        task,
      );

      const result = await printer.send("# heading\nbody line", "a-trace");
      expect(result).to.equal("# heading\nbody line");
    });
  });

  describe("bitbang NEC encoding", function () {
    it("emits four bytes of payload", function () {
      expect(necToBits({ address: 0x7c, command: 0x66 })).to.have.lengthOf(32);
    });

    it("frames a wave with a header and a trailer", function () {
      const wave = necToWave({ address: 0x7c, command: 0x66 }, 23);

      // every pulse drives exactly the configured pin
      expect(
        wave.every((pulse) => pulse.gpioOn === 23 || pulse.gpioOff === 23),
      ).to.equal(true);
      // the 4500us header gap is a single low pulse, unlike the carrier
      expect(
        wave.some((pulse) => pulse.usDelay === 4500 && pulse.gpioOn === 0),
      ).to.equal(true);
    });

    it("honors a non-default LED pin", function () {
      const wave = necToWave({ address: 0x7c, command: 0x66 }, 17);

      expect(wave.some((pulse) => pulse.gpioOn === 23)).to.equal(false);
      expect(wave.some((pulse) => pulse.gpioOn === 17)).to.equal(true);
    });
  });

  describe("bitbang NEC transmission", function () {
    const command = { address: 0x7c, command: 0x66 };

    it("deletes the wave only after the transmission has drained", async function () {
      const { calls, pigpio } = createPigpioMock();

      await transmitNECCommand(pigpio, command, 23);

      expect(
        calls.filter((call) => !call.startsWith("waveTxBusy")),
      ).to.deep.equal([
        "waveClear",
        "waveAddGeneric",
        "waveCreate",
        `waveTxSend(${MOCK_WAVE_ID}, 0)`,
        `waveDelete(${MOCK_WAVE_ID})`,
      ]);
      // the v3 bug: the promise never settled, and the wave was deleted while
      // it was still transmitting
      expect(calls.indexOf(`waveDelete(${MOCK_WAVE_ID})`)).to.be.greaterThan(
        calls.lastIndexOf("waveTxBusy(true)"),
      );
      expect(calls.at(-2)).to.equal("waveTxBusy(false)");
    });

    it("waits for as long as the queue stays busy", async function () {
      const { calls, pigpio } = createPigpioMock({ busyFor: 3 });

      await transmitNECCommand(pigpio, command, 23);

      expect(
        calls.filter((call) => call === "waveTxBusy(true)"),
      ).to.have.lengthOf(3);
      expect(calls.at(-1)).to.equal(`waveDelete(${MOCK_WAVE_ID})`);
    });

    it("still deletes the wave when the transmission throws", async function () {
      const { calls, pigpio } = createPigpioMock();
      pigpio.waveTxSend = () => {
        throw new Error("no gpio here");
      };

      await expect(transmitNECCommand(pigpio, command, 23)).to.be.rejectedWith(
        /no gpio here/,
      );

      expect(calls).to.include(`waveDelete(${MOCK_WAVE_ID})`);
    });
  });

  describe("doAggregation", function () {
    it("sums", function () {
      expect(doAggregation([1, 2, 3], "sum")).to.equal(6);
    });

    it("takes a median of an odd-length set", function () {
      expect(doAggregation([3, 1, 2], "median")).to.equal(2);
    });

    it("interpolates a median of an even-length set", function () {
      expect(doAggregation([1, 2, 3, 4], "median")).to.equal(2.5);
    });

    it("treats median as p50", function () {
      expect(doAggregation([1, 2, 3, 4], "p50")).to.equal(
        doAggregation([1, 2, 3, 4], "median"),
      );
    });

    it("interpolates an arbitrary percentile", function () {
      // rank = 0.95 * 9 = 8.55, between the 9th and 10th values
      expect(
        doAggregation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "p95"),
      ).to.be.closeTo(9.55, 1e-9);
    });

    it("accepts fractional percentiles", function () {
      expect(
        doAggregation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "p99.5"),
      ).to.be.closeTo(9.955, 1e-9);
    });

    it("bounds p0 and p100 to the extremes", function () {
      expect(doAggregation([5, 1, 9], "p0")).to.equal(1);
      expect(doAggregation([5, 1, 9], "p100")).to.equal(9);
    });

    it("still supports latest and average", function () {
      expect(doAggregation([1, 2, 3], "latest")).to.equal(3);
      expect(doAggregation([1, 2, 3], "average")).to.equal(2);
    });

    it("reads through a path", function () {
      const samples = [{ v: 1 }, { v: 3 }, { v: 5 }] as any;
      expect(doAggregation(samples, "sum", "v")).to.equal(9);
      expect(doAggregation(samples, "median", "v")).to.equal(3);
    });

    it("collapses a single datapoint to latest regardless of aggregation", function () {
      expect(doAggregation([7], "sum")).to.equal(7);
    });

    it("throws on an unsupported aggregation", function () {
      expect(() => doAggregation([1, 2], "nonsense")).to.throw(
        /Unsupported aggregation/,
      );
    });

    it("throws on an out-of-range percentile", function () {
      expect(() => doAggregation([1, 2], "p101")).to.throw(
        /Unsupported aggregation/,
      );
    });
  });

  describe("output:stash", function () {
    async function stashValue(value: unknown, message: unknown = "a message") {
      const task = new Task(
        {
          steps: [
            { type: "output:stash", key: "stashed", value } as any,
            // The stash belongs to the message, not the task, so the only way
            // to see what was stashed is from inside the same message.
            { type: "read:stash", key: "stashed" } as any,
          ],
        },
        "stashes a value",
      );
      await task.register();

      return task.startMessage(message as any);
    }

    it("stashes a number without stringifying it", async function () {
      expect(await stashValue(42)).to.equal(42);
    });

    it("stashes an object without stringifying it", async function () {
      expect(await stashValue({ a: 1, b: [2, 3] })).to.deep.equal({
        a: 1,
        b: [2, 3],
      });
    });

    it("stashes a boolean without stringifying it", async function () {
      expect(await stashValue(false)).to.equal(false);
    });

    it("interpolates a string value", async function () {
      expect(await stashValue("hello ${message}", "world")).to.equal(
        "hello world",
      );
    });
  });

  describe("output:influxdb", function () {
    // One InfluxDB connection plus a task that stashes a value before writing,
    // with sendLine stubbed so the line protocol can be read back without a
    // server.
    async function lineFor(
      config: object,
      message: object,
      { precision = "ms", deviceId = "kitchen-pi" } = {},
    ) {
      const connection = new InfluxDBConnection({
        type: "connection:influxdb",
        name: "influx",
        url: "http://127.0.0.1:8086/api/v2/write",
        organization: "home",
        bucket: "sensors",
        token: "a-token",
        precision,
      } as any);
      // src/connections/influxdb.ts opts fetchConfig out of the base
      // signature, so the instance is not assignable to Connection
      globals.connections.push(connection as unknown as Connection);

      const task = new Task(
        {
          steps: [
            { type: "output:stash", key: "deviceId", value: deviceId } as any,
            { type: "output:influxdb", connectionName: "influx", ...config },
          ],
        },
        "writes a point to influxdb",
      );
      await task.register();

      const lines: Array<string> = [];
      (task.steps[1] as InfluxDB).sendLine = async (line: string) => {
        lines.push(line);
        return undefined as any;
      };

      try {
        await task.startMessage(message as any);
        expect(lines).to.have.lengthOf(1);
        return lines[0];
      } finally {
        globals.connections.length = 0;
      }
    }

    it("interpolates a configured tag value", async function () {
      const line = await lineFor(
        { measurement: "climate", tags: { device: "${stash.deviceId}" } },
        { fields: { temp: 21.5 } },
      );

      expect(line).to.include("device=kitchen-pi");
      expect(line).to.not.include("${stash.deviceId}");
    });

    it("interpolates the measurement name", async function () {
      const line = await lineFor(
        { measurement: "climate-${stash.deviceId}", tags: {} },
        { fields: { temp: 21.5 } },
      );

      expect(line.split(" ")[0]).to.equal("climate-kitchen-pi");
    });

    it("interpolates a tag supplied on the message, letting it win", async function () {
      const line = await lineFor(
        {
          measurement: "climate",
          tags: { device: "unset", room: "kitchen" },
        },
        { fields: { temp: 21.5 }, tags: { device: "${stash.deviceId}" } },
      );

      expect(line).to.include("device=kitchen-pi");
      expect(line).to.include("room=kitchen");
      expect(line).to.not.include("device=unset");
    });

    it("escapes separators in an interpolated tag value", async function () {
      const line = await lineFor(
        { measurement: "climate", tags: { device: "${stash.deviceId}" } },
        { fields: { temp: 21.5 } },
        { deviceId: "kitchen pi,room=a" },
      );

      expect(line).to.include("device=kitchen\\ pi\\,room\\=a");
    });

    it("writes a second-precision timestamp in seconds", async function () {
      const before = Math.floor(Date.now() / 1000);
      const line = await lineFor(
        { measurement: "climate", tags: {} },
        { fields: { temp: 21.5 } },
        { precision: "s" },
      );

      const timestamp = Number(line.split(" ").pop());
      expect(timestamp).to.be.at.least(before);
      expect(timestamp).to.be.at.most(Math.floor(Date.now() / 1000));
    });

    it("writes a nanosecond-precision timestamp in nanoseconds", async function () {
      const before = Date.now() * 1000000;
      const line = await lineFor(
        { measurement: "climate", tags: {} },
        { fields: { temp: 21.5 } },
        { precision: "ns" },
      );

      const timestamp = Number(line.split(" ").pop());
      expect(timestamp).to.be.at.least(before);
      expect(timestamp).to.be.at.most(Date.now() * 1000000);
    });
  });

  describe("credential redaction", function () {
    it("leaves no password, username, or token in what registerConnections emits", async function () {
      const emitted: Array<unknown> = [];
      const capturingLogger = {
        ...fakeLogger,
        emit: (
          _message: string,
          _verbosity: string,
          _topic: string,
          object?: object,
        ) => {
          if (object) emitted.push(object);
        },
      };
      setGlobals({
        logger: capturingLogger,
        connections: [],
        tasks: [],
        eventBus: new EventEmitter(),
      } as any);

      // The InfluxDB connection opens no socket on register, so this exercises
      // registration without needing a live server.
      await registerConnections([
        {
          type: "connection:influxdb",
          name: "influx",
          url: "http://127.0.0.1:8086/api/v2/write",
          organization: "home",
          bucket: "sensors",
          token: "SUPERSECRETTOKEN",
          password: "SUPERSECRETPW",
          username: "SUPERSECRETUSER",
          precision: "ns",
        } as any,
      ]);

      const serialized = JSON.stringify(emitted);
      expect(emitted.length).to.be.greaterThan(0);
      expect(serialized).to.not.include("SUPERSECRETTOKEN");
      expect(serialized).to.not.include("SUPERSECRETPW");
      expect(serialized).to.not.include("SUPERSECRETUSER");
      // The non-secret fields still come through, so this is redaction rather
      // than the whole object going missing.
      expect(serialized).to.include("influx");

      setGlobals({
        logger: fakeLogger,
        connections: [],
        tasks: [],
        eventBus: new EventEmitter(),
      } as any);
    });

    it("redacts secrets nested inside a whole config file", function () {
      const redacted = redact({
        connections: [
          {
            name: "a",
            password: "pw",
            token: "tok",
            apiKey: "ak",
            secret: "sh",
            endpoint: "mqtt://x",
          },
        ],
        tasks: {},
      });

      expect(redacted.connections[0].password).to.equal("[redacted]");
      expect(redacted.connections[0].token).to.equal("[redacted]");
      expect(redacted.connections[0].apiKey).to.equal("[redacted]");
      expect(redacted.connections[0].secret).to.equal("[redacted]");
      expect(redacted.connections[0].endpoint).to.equal("mqtt://x");
    });

    // An endpoint carries a credential in its userinfo, under a key no denylist
    // would catch.
    it("strips userinfo out of an endpoint while keeping host and port", function () {
      const redacted = redact({
        connections: [{ endpoint: "mqtt://user:pass@broker:1883" }],
      });

      expect(redacted.connections[0].endpoint).to.equal("mqtt://broker:1883");
    });

    it("leaves a string that is not a URL exactly as it is", function () {
      expect(redact({ topic: "data/weather/kitchen" }).topic).to.equal(
        "data/weather/kitchen",
      );
      expect(redact({ note: "mail me at user@example.com" }).note).to.equal(
        "mail me at user@example.com",
      );
    });

    // read:stash, output:stash, and the event modules all take a `key` that
    // names a place rather than a credential; masking it would blank out the
    // useful half of every registration line.
    it("does not redact a key, which is a stash path or an event name", function () {
      expect(redact({ key: "device.name" }).key).to.equal("device.name");
    });

    it("does not mutate the config it redacts", function () {
      const original = { connections: [{ password: "pw" }] };
      redact(original);

      expect(original.connections[0].password).to.equal("pw");
    });
  });

  describe("output:file", function () {
    afterEach(function () {
      appendFile.mock.resetCalls();
      writeFile.mock.resetCalls();
    });

    async function writeThrough(name: string, config: object) {
      const task = new Task(
        {
          steps: [
            {
              type: "output:file",
              path: "/tmp/cutie-output-file-test",
              ...config,
            } as any,
          ],
        },
        name,
      );
      await task.register();
      await task.startMessage("a line");
    }

    it("appends rather than overwriting, unless told otherwise", async function () {
      await writeThrough("appends by default", {});

      expect(appendFile.mock.callCount()).to.equal(1);
      expect(writeFile.mock.callCount()).to.equal(0);
    });

    // Trailing rather than leading, so a file that is only ever appended to
    // ends in a complete line instead of starting with a blank one.
    it("ends each appended message with a newline", async function () {
      await writeThrough("inserts newlines by default", {});

      expect(appendFile.mock.calls[0].arguments[1]).to.equal("a line\n");
    });

    it("overwrites the file when append is false", async function () {
      await writeThrough("overwrites on request", { append: false });

      expect(writeFile.mock.callCount()).to.equal(1);
      expect(appendFile.mock.callCount()).to.equal(0);
    });

    it("writes to the configured path with the configured encoding", async function () {
      await writeThrough("honors the encoding", { encoding: "latin1" });

      expect(appendFile.mock.calls[0].arguments[0]).to.equal(
        "/tmp/cutie-output-file-test",
      );
      expect(appendFile.mock.calls[0].arguments[2]).to.deep.equal({
        encoding: "latin1",
      });
    });
  });
});
