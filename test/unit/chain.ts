import { after, before, describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, globals, setGlobals } from "../../src/index.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import { listModules } from "../../src/util/modules.js";
import Step from "../../src/util/Step.js";
import Task from "../../src/util/Task.js";

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

function useFakeGlobals(configDir = process.cwd()) {
  setGlobals({
    tasks: [],
    connections: [],
    version: "test-version",
    logger: fakeLogger,
    eventBus: new EventEmitter(),
    configDir,
  } as unknown as Globals);
}

async function registered(config: any, name: string) {
  const task = new Task(config, name);
  await task.register();

  return task;
}

// Reads a stashed value back out from inside the same message, which is the
// only place a stash is reachable now.
function readBack(key: string) {
  return { type: "read:stash", key };
}

describe("the message chain", function () {
  before(function () {
    useFakeGlobals();
  });

  describe("a disabled step", function () {
    it("is absent from the chain rather than linked and skipped", async function (context) {
      const log = context.mock.method(console, "log", () => {});
      const task = await registered(
        {
          steps: [
            { type: "output:console", disabled: true },
            readBack("never"),
          ],
        },
        "a disabled console",
      );

      expect(task.steps).to.have.lengthOf(1);
      expect(log.mock.callCount()).to.equal(0);
    });

    it("passes the message through unchanged", async function (context) {
      context.mock.method(console, "log", () => {});
      const task = await registered(
        { steps: [{ type: "output:console", disabled: true }] },
        "a disabled console passes through",
      );

      expect(await task.startMessage({ a: 1 })).to.deep.equal({ a: 1 });
    });

    it("does not transform when it is a disabled transform", async function () {
      const task = await registered(
        {
          steps: [{ type: "transform:round", precision: 0, disabled: true }],
        },
        "a disabled round",
      );

      expect(await task.startMessage(21.456)).to.equal(21.456);
    });

    it("still lets the chain reach the step after it at index 0", async function () {
      const task = await registered(
        {
          steps: [
            { type: "transform:round", precision: 0, disabled: true },
            { type: "transform:offset", offset: 1 },
          ],
        },
        "a disabled first step",
      );

      expect(await task.startMessage(1.5)).to.equal(2.5);
    });

    it("keeps the log topic of the steps after it at their config positions", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:console", disabled: true },
            { type: "transform:offset", offset: 1 },
          ],
        },
        "topics survive a skip",
      );

      expect(task.steps.map((step) => step.logPrefix)).to.deep.equal([
        "core.runtime.tasks.topics survive a skip.steps.1",
      ]);
    });
  });

  describe("the stash", function () {
    it("belongs to one message, not to the task", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "seen", value: "${message}" },
            // An awaited step between the write and the read, so the two
            // messages below are genuinely interleaved rather than sequential.
            { type: "transform:offset", offset: 0 },
            readBack("seen"),
          ],
        },
        "interleaved stashes",
      );

      const [first, second] = await Promise.all([
        task.startMessage("a"),
        task.startMessage("b"),
      ]);

      expect(first).to.equal("a");
      expect(second).to.equal("b");
    });

    it("starts empty for every message", async function () {
      const writer = await registered(
        {
          steps: [{ type: "output:stash", key: "leaked", value: "from a" }],
        },
        "writes a stash",
      );
      const reader = await registered(
        { steps: [readBack("leaked")] },
        "reads the same key",
      );

      await writer.startMessage("a");

      expect(await reader.startMessage("b")).to.equal(undefined);
    });

    it("resolves in ${stash.x} within the writing message", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "who", value: "world" },
            { type: "read:constant", value: "hello ${stash.who}" },
          ],
        },
        "interpolates its own stash",
      );

      expect(await task.startMessage("ignored")).to.equal("hello world");
    });

    it("round-trips a dotted key as a nested path", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "device.name", value: "kitchen" },
            readBack("device.name"),
          ],
        },
        "a dotted stash key",
      );

      expect(await task.startMessage("x")).to.equal("kitchen");
    });

    it("lets two keys share a parent", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "device.name", value: "kitchen" },
            { type: "output:stash", key: "device.id", value: 7 },
            readBack("device"),
          ],
        },
        "two dotted stash keys",
      );

      expect(await task.startMessage("x")).to.deep.equal({
        name: "kitchen",
        id: 7,
      });
    });

    it("round-trips an indexed key", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "readings[0]", value: 21 },
            readBack("readings[0]"),
          ],
        },
        "an indexed stash key",
      );

      expect(await task.startMessage("x")).to.equal(21);
    });

    it("still round-trips a flat key", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "fname", value: "notes.txt" },
            readBack("fname"),
          ],
        },
        "a flat stash key",
      );

      expect(await task.startMessage("x")).to.equal("notes.txt");
    });
  });

  describe("a config-relative path", function () {
    let directory: string;

    before(async function () {
      directory = await mkdtemp(join(tmpdir(), "cutie-codepath-"));
      await writeFile(join(directory, "double.js"), "message * 2;");
    });

    after(async function () {
      await rm(directory, { recursive: true, force: true });
      useFakeGlobals();
    });

    it("resolves against the config directory, not the process cwd", async function () {
      useFakeGlobals(directory);
      const task = await registered(
        {
          steps: [
            {
              type: "transform:javascript",
              codePath: "./double.js",
              outputType: "number",
            },
          ],
        },
        "a relative codePath",
      );

      expect(await task.startMessage(21)).to.equal(42);
    });

    it("uses an absolute path as given", async function () {
      useFakeGlobals("/nowhere-at-all");
      const task = await registered(
        {
          steps: [
            {
              type: "transform:javascript",
              codePath: join(directory, "double.js"),
              outputType: "number",
            },
          ],
        },
        "an absolute codePath",
      );

      expect(await task.startMessage(21)).to.equal(42);
    });

    it("names the resolved path and the config directory when the file is missing", async function () {
      useFakeGlobals(directory);
      const task = await registered(
        {
          steps: [
            {
              type: "transform:javascript",
              codePath: "./absent.js",
              outputType: "number",
            },
          ],
        },
        "a missing codePath",
      );

      await expect(task.startMessage(1)).to.be.rejectedWith(
        new RegExp(
          `Could not read codePath "\\./absent\\.js".*${directory.replace(/[\\/]/g, "[\\\\/]")}`,
        ),
      );
    });
  });

  describe("the interpolation context", function () {
    // Every module that interpolates should see the same names, so one table
    // covers all of them rather than one test per module.
    const TEMPLATE =
      "${task.name}|${env.CUTIE_TEST_VALUE}|${module.type}|${stash.who}|${globals.version}";
    // ${module} is the interpolating step's own config, so the third field names
    // whichever module resolved the template.
    const expectedFor = (type: string) =>
      `reaches every name|from the env|${type}|world|test-version`;

    before(function () {
      useFakeGlobals();
      process.env.CUTIE_TEST_VALUE = "from the env";
    });

    after(function () {
      delete process.env.CUTIE_TEST_VALUE;
    });

    it("offers task, env, module, stash, and globals to a read", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "who", value: "world" },
            { type: "read:constant", value: TEMPLATE },
          ],
        },
        "reaches every name",
      );

      expect(await task.startMessage("x")).to.equal(
        expectedFor("read:constant"),
      );
    });

    it("offers the same names to an output's interpolated option", async function () {
      const task = await registered(
        {
          steps: [
            { type: "output:stash", key: "who", value: "world" },
            { type: "output:stash", key: "built", value: TEMPLATE },
            readBack("built"),
          ],
        },
        "reaches every name",
      );

      expect(await task.startMessage("x")).to.equal(
        expectedFor("output:stash"),
      );
    });

    it("resolves ${message} to the message the step was handed", async function () {
      const task = await registered(
        {
          steps: [
            { type: "transform:offset", offset: 1 },
            { type: "read:constant", value: "now ${message}" },
          ],
        },
        "sees the current message",
      );

      expect(await task.startMessage(41)).to.equal("now 42");
    });

    it("resolves ${message} to the sentinel before a message exists", async function () {
      const task = new Task({ steps: [] }, "no message yet");
      const step = await task.importStep({
        type: "read:constant",
        value: "x",
      } as never);

      expect(step.interpolateConfigString("saw ${message}")).to.equal(
        "saw (no message)",
      );
    });
  });

  describe("the globals in the interpolation context", function () {
    after(function () {
      useFakeGlobals();
    });

    it("redacts a connection's credentials without touching the live one", async function () {
      useFakeGlobals();
      const connection = new MQTTConnection({
        type: "connection:mqtt",
        name: "broker",
        endpoint: "mqtt://127.0.0.1:1883",
        password: "hunter2",
        username: "someone",
      } as never);
      globals.connections.push(connection);

      const task = new Task({ steps: [] }, "redacts");
      const step = await task.importStep({
        type: "read:constant",
        value: "x",
      } as never);

      expect(
        step.interpolateConfigString(
          "${globals.connections[0].config.password}",
        ),
      ).to.equal("[redacted]");
      // The connection the client actually uses still holds the credential.
      expect(
        (connection.config as unknown as { password: string }).password,
      ).to.equal("hunter2");
    });
  });

  describe("transform targeting", function () {
    before(function () {
      useFakeGlobals();
    });

    it("rejects path alongside paths", async function () {
      await expect(
        registered(
          {
            steps: [
              {
                type: "transform:round",
                path: "a",
                paths: { b: { precision: 1 } },
              },
            ],
          },
          "both forms",
        ),
      ).to.be.rejectedWith('"path" cannot be combined with "paths"');
    });

    it("rejects a per-path option left at the top level", async function () {
      await expect(
        registered(
          {
            steps: [
              {
                type: "transform:round",
                precision: 2,
                paths: { b: { precision: 1 } },
              },
            ],
          },
          "a stray option",
        ),
      ).to.be.rejectedWith('"precision" cannot be combined with "paths"');
    });

    it("rejects basePath on a read", async function () {
      await expect(
        registered(
          {
            steps: [{ type: "read:constant", value: 1, basePath: "readings" }],
          },
          "basePath on a read",
        ),
      ).to.be.rejectedWith('does not accept "basePath"');
    });

    it("rejects basePath on a transform that ignores it", async function () {
      await expect(
        registered(
          { steps: [{ type: "transform:prettify", basePath: "readings" }] },
          "basePath on prettify",
        ),
      ).to.be.rejectedWith('does not accept "basePath"');
    });

    it("fails at runtime when basePath points at something other than an array", async function () {
      const task = await registered(
        {
          steps: [
            { type: "transform:round", basePath: "readings", path: "temp" },
          ],
        },
        "basePath at a non-array",
      );

      await expect(
        task.startMessage({ readings: { temp: 1.23 } }),
      ).to.be.rejectedWith(
        /"basePath" "readings" should point at an array, but found an object/,
      );
    });

    it("still walks an array that basePath does point at", async function () {
      const task = await registered(
        {
          steps: [
            {
              type: "transform:round",
              basePath: "readings",
              path: "temp",
              precision: 1,
            },
          ],
        },
        "basePath at an array",
      );

      expect(
        await task.startMessage({ readings: [{ temp: 1.26 }, { temp: 2.34 }] }),
      ).to.deep.equal({ readings: [{ temp: 1.3 }, { temp: 2.3 }] });
    });
  });

  describe("every output", function () {
    // Driven from the filesystem so a new output cannot quietly opt out. The
    // four that need something outside the process -- three native packages and
    // one InfluxDB server -- run with send() stubbed to return a deliberately
    // wrong value, which is also the sharpest test of the base class's promise.
    const NEEDS_EXTERNAL = ["influxdb", "nec", "switchbots", "thermal-printer"];

    before(function () {
      useFakeGlobals();
    });

    it("returns its input unchanged", async function (context) {
      context.mock.method(console, "log", () => {});
      const outputs = (await listModules()).output;
      const directory = await mkdtemp(join(tmpdir(), "cutie-outputs-"));

      try {
        for (const subKind of outputs) {
          const type = `output:${subKind}`;
          const task = new Task({ steps: [] }, `returns input ${subKind}`);
          const step = (await task.importStep({
            type,
            // enough for the outputs that need an option to construct
            key: "k",
            value: "v",
            path: join(directory, `${subKind}.log`),
            topics: ["t"],
            name: subKind,
            event: "an-event",
            ledPin: 23,
            devicePath: "/dev/null",
            measurement: "m",
          } as never)) as unknown as Step & {
            send: (message: unknown) => Promise<unknown>;
          };

          if (NEEDS_EXTERNAL.includes(subKind))
            step.send = async () => "a mangled return value";

          const message = { a: 1, b: [2, 3] };

          // handleMessage, not doHandleMessage: it is what opens the message
          // store the stash output writes into.
          expect(
            await step.handleMessage(message, "trace"),
            type,
          ).to.deep.equal(message);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("leaves a later transform something it can still round", async function (context) {
      context.mock.method(console, "log", () => {});
      const task = await registered(
        {
          steps: [
            { type: "output:console" },
            { type: "transform:round", path: "temp", precision: 1 },
          ],
        },
        "an output before a transform",
      );

      expect(await task.startMessage({ temp: 21.456 })).to.deep.equal({
        temp: 21.5,
      });
    });
  });
});
