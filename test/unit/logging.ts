import { after, afterEach, before, describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, globals, setGlobals } from "../../src/index.js";
import { Verbosity } from "../../src/triggers/logs.js";
import LogHelper from "../../src/util/LogHelper.js";
import { LOG_LEVELS } from "../../src/util/cli.js";
import { fetchConfig } from "../../src/util/configs.js";
import { registerConnections } from "../../src/util/connections.js";
import Task from "../../src/util/Task.js";
import { registerTasks } from "../../src/util/tasks.js";
import { createMqttMock } from "../helpers.js";

interface Record {
  level: Verbosity;
  object: unknown;
  message: string;
}

// A real LogHelper with pino replaced after construction: the guard, the level
// check, and the fan-out are all the real ones, but the records land here
// instead of on the terminal.
function realLogger(level?: Verbosity) {
  const helper = new LogHelper(level);
  const records: Array<Record> = [];
  const capture = (captured: Verbosity) => (object: unknown, message: string) =>
    records.push({ level: captured, object, message });

  helper.logger = Object.fromEntries(
    LOG_LEVELS.map((name) => [name, capture(name)]),
  ) as never;

  return { helper, records };
}

function useLogger(level?: Verbosity) {
  const { helper, records } = realLogger(level);

  setGlobals({
    tasks: [],
    connections: [],
    version: "test-version",
    logger: helper,
    eventBus: new EventEmitter(),
    configDir: process.cwd(),
  } as unknown as Globals);

  return { helper, records };
}

// Lets the not-awaited dispatch chains run to completion.
function settle(ticks = 5) {
  return new Promise<void>((resolve) => setTimeout(resolve, ticks));
}

// Waits for the dispatch to actually arrive rather than for a fixed number of
// milliseconds, which under a parallel test run is not the same thing.
async function handled(task: Task, count: number, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;

  while (task.messagesHandled < count && Date.now() < deadline) await settle(1);

  return task.messagesHandled;
}

// A runaway fan-out grows exponentially and starves the macrotask queue, which
// reads as a hung test rather than a failing one. Cutting the listeners at the
// source stops the growth synchronously, so a regression fails an assertion
// instead of wedging the run. Cutting it at endMessage does not work: thousands
// of chains are already in flight by the time any of them finishes.
const RUNAWAY_CAP = 25;

function capDispatches(helper: LogHelper) {
  const original = helper.emit.bind(helper);
  const counted = { dispatches: 0 };

  helper.emit = (message, verbosity, topic, object) => {
    if (++counted.dispatches > RUNAWAY_CAP) {
      helper.logListeners.length = 0;
      return;
    }

    original(message, verbosity, topic, object);
  };

  return counted;
}

describe("logging", function () {
  let directory: string;

  before(async function () {
    directory = await mkdtemp(join(tmpdir(), "cutie-logging-"));
  });

  after(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  afterEach(async function () {
    await Promise.allSettled(
      globals.tasks.map((task) => task.trigger?.disable()),
    );
    globals.tasks.length = 0;
  });

  describe("a log line", function () {
    it("reaches pino as well as the trigger:logs listeners", async function () {
      const { records } = useLogger();
      const task = new Task(
        {
          trigger: {
            type: "trigger:logs",
            filters: ["core.test"],
            minVerbosity: "trace",
          } as never,
          steps: [{ type: "output:stash", key: "line", value: "x" } as never],
        },
        "sees the line",
      );
      await task.register();
      globals.tasks.push(task);

      globals.logger.emit("a line worth seeing", "info", "core.test");
      await settle();

      expect(
        records.some((entry) => entry.message === "a line worth seeing"),
      ).to.equal(true);
      expect(task.messagesHandled).to.be.greaterThan(0);
    });

    it("carries a module's own error to pino under the module's topic", async function () {
      const { records } = useLogger();
      const task = new Task({ steps: [] }, "an erroring module");
      const step = await task.importStep(
        {
          type: "read:constant",
          value: 1,
        } as never,
        0,
      );

      step.error("something went wrong", { topic: step.logPrefix });

      const found = records.find((entry) =>
        entry.message.includes("something went wrong"),
      );

      expect(found?.level).to.equal("error");
      expect(found?.message).to.include(step.logPrefix);
    });

    it("reaches a listener under the module's own topic with no topic passed", async function () {
      useLogger();
      const listening = new Task(
        {
          trigger: {
            type: "trigger:logs",
            filters: ["core.runtime.tasks.*"],
            minVerbosity: "trace",
          } as never,
          steps: [{ type: "output:stash", key: "line", value: "x" } as never],
        },
        "sees module lines",
      );
      await listening.register();
      globals.tasks.push(listening);

      const task = new Task({ steps: [] }, "a quiet module");
      const step = await task.importStep(
        { type: "read:constant", value: 1 } as never,
        0,
      );

      step.info("no topic given");
      await handled(listening, 1);

      expect(listening.messagesHandled).to.equal(1);
    });

    it("carries a passthrough to a listener as well as to pino", async function () {
      const { records } = useLogger();
      const listening = new Task(
        {
          trigger: {
            type: "trigger:logs",
            filters: ["core.runtime"],
            minVerbosity: "trace",
          } as never,
          steps: [{ type: "output:stash", key: "line", value: "x" } as never],
        },
        "sees runtime lines",
      );
      await listening.register();
      globals.tasks.push(listening);

      // The line a node republishing its own logs most needs to see.
      globals.logger.fatal("Uncaught Exception. Terminating now.");
      await handled(listening, 1);

      expect(
        records.some((entry) =>
          entry.message.includes("Uncaught Exception. Terminating now."),
        ),
      ).to.equal(true);
      expect(listening.messagesHandled).to.equal(1);
    });

    it("keeps the re-entrancy guard when a passthrough runs inside a dispatch", async function () {
      const { helper } = useLogger();
      const listening = new Task(
        {
          trigger: {
            type: "trigger:logs",
            filters: ["*"],
            minVerbosity: "trace",
          } as never,
          steps: [{ type: "output:stash", key: "line", value: "x" } as never],
        },
        "logs while handling a log",
      );
      await listening.register();
      globals.tasks.push(listening);

      const counted = capDispatches(helper);
      // A step that logs through the passthrough while a dispatch is in flight
      // would fan out forever without the guard.
      listening.steps[0].doHandleMessage = async (message) => {
        globals.logger.warn("logging from inside a dispatch");
        return message;
      };

      globals.logger.emit("the first line", "info", "core.test");
      await settle(20);

      expect(counted.dispatches).to.be.lessThan(RUNAWAY_CAP);
      expect(helper.logListeners).to.include(listening.trigger);
    });

    it("is suppressed below the configured level", function () {
      const { helper, records } = useLogger("warn");

      helper.emit("chatter", "info", "core.test");
      helper.emit("a real problem", "error", "core.test");

      expect(records.map((entry) => entry.message)).to.deep.equal([
        "a real problem",
      ]);
    });

    it("reaches pino at the default level when none is given", function () {
      const { helper, records } = useLogger();

      helper.emit("chatter", "info", "core.test");

      expect(records).to.have.lengthOf(1);
    });
  });

  describe("an invalid log level", function () {
    it("is rejected naming the valid ones", function () {
      expect(() => new LogHelper("verbose" as Verbosity)).to.throw(
        `Unknown log level "verbose"; expected one of: ${LOG_LEVELS.join(", ")}.`,
      );
    });
  });

  describe("the re-entrancy guard", function () {
    // Every one of these chains logs while it runs, so without the guard each
    // line it produces starts another dispatch and the task never settles.
    const OUTPUTS = [
      { type: "output:stash", key: "line", value: "x" },
      { type: "output:event", key: "a-happening" },
      { type: "output:console" },
      { type: "output:file", append: true },
    ];

    for (const output of OUTPUTS) {
      it(`terminates for a trigger:logs task feeding ${output.type}`, async function (context) {
        context.mock.method(console, "log", () => {});
        const { helper } = useLogger();
        const task = new Task(
          {
            trigger: {
              type: "trigger:logs",
              filters: ["*"],
              minVerbosity: "trace",
            } as never,
            steps: [
              // Transform.debug logs on every message, so the chain generates
              // log lines even for the outputs that do not log themselves.
              { type: "transform:offset", offset: 0 } as never,
              {
                ...output,
                path: join(directory, "logs.txt"),
              } as never,
            ],
          },
          `logs into ${output.type}`,
        );
        await task.register();
        globals.tasks.push(task);
        const counted = capDispatches(helper);

        helper.emit("one line", "info", "core.test");
        await handled(task, 1);
        // Long enough for a runaway fan-out to show itself.
        await settle(20);

        // Exactly the one line dispatched: everything the chain logged while
        // handling it was written to pino but started no further dispatch.
        expect(task.messagesHandled).to.equal(1);
        expect(counted.dispatches).to.be.at.most(RUNAWAY_CAP);
      });
    }

    it("still delivers a line emitted outside a dispatch", async function () {
      useLogger();
      const task = new Task(
        {
          trigger: {
            type: "trigger:logs",
            filters: ["core.test"],
            minVerbosity: "trace",
          } as never,
          steps: [],
        },
        "two separate lines",
      );
      await task.register();
      globals.tasks.push(task);

      globals.logger.emit("first", "info", "core.test");
      await settle();
      globals.logger.emit("second", "info", "core.test");
      await settle();

      expect(task.messagesHandled).to.equal(2);
    });

    it("delivers the same line to two trigger:logs tasks", async function () {
      useLogger();
      const tasks = ["first listener", "second listener"].map(
        (name) =>
          new Task(
            {
              trigger: {
                type: "trigger:logs",
                filters: ["core.test"],
                minVerbosity: "trace",
              } as never,
              steps: [],
            },
            name,
          ),
      );

      for (const task of tasks) {
        await task.register();
        globals.tasks.push(task);
      }

      globals.logger.emit("heard by both", "info", "core.test");
      await settle();

      expect(tasks.map((task) => task.messagesHandled)).to.deep.equal([1, 1]);
    });
  });

  describe("the shipped config", function () {
    // It names a broker, and a real client would spend its whole connect
    // timeout reaching for one that is not running.
    before(function () {
      mock.module("mqtt", { defaultExport: createMqttMock().mqtt });
    });

    it("logs its registration to pino", async function () {
      const { records } = useLogger();
      const config = await fetchConfig("./config/cutie.conf.yaml");

      await registerConnections(config.connections ?? []);
      await registerTasks(config.tasks ?? {});

      try {
        expect(
          records.some((entry) => /Registered task\./.test(entry.message)),
          "no registration record reached pino",
        ).to.equal(true);
      } finally {
        // The logs task publishes to the broker, so it stops before the
        // connection it publishes on does.
        const [logs, rest] = [
          globals.tasks.filter((task) => task.name === "logs"),
          globals.tasks.filter((task) => task.name !== "logs"),
        ];

        for (const group of [logs, rest])
          await Promise.allSettled(
            group.map((task) => task.trigger?.disable()),
          );

        await new Promise((resolve) => setImmediate(resolve));

        await Promise.allSettled(
          globals.connections.map((connection) => connection.disable()),
        );
      }
    });
  });
});
