import { describe, it, before, after } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { setGlobals } from "../../src/index.js";

import { OnceConfig } from "../../src/triggers/once.js";
import { taskDone } from "../helpers.js";

describe("triggers", function () {
  const fakeLogger = {
    emit: () => {},
    logListeners: [] as Array<unknown>,
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  before(() => {
    setGlobals({ logger: fakeLogger } as any);
  });

  describe("specific triggers", function () {
    describe("once", function () {
      let nameEnvVariable: string | undefined;

      before(() => {
        nameEnvVariable = process.env.name;
        process.env.name = "world";
      });

      after(() => {
        process.env.name = nameEnvVariable;
        (console.log as unknown as it.Mock<any>).mock.restore();
      });

      it("interpolates the provided message", async function (context) {
        const task = new Task(
          {
            steps: [{ type: "output:console" }],
            trigger: {
              type: "trigger:once",
              message: "hello ${env.name}",
            } as OnceConfig,
          },
          "interpolates the provided message",
        );
        console.log = context.mock.fn(console.log, () => {}, { times: 1 });

        await task.register();
        await taskDone(task);

        expect(
          (console.log as unknown as it.Mock<any>).mock.calls[0].arguments[0],
        ).to.equal("hello world");
      });
    });
  });

  describe("trigger:logs", function () {
    async function listening(trigger: object) {
      const task = new Task(
        { trigger: trigger as any, steps: [] },
        "listens to logs",
      );
      await task.register();

      return task;
    }

    it("matches everything when no filters are given", async function () {
      const task = await listening({ type: "trigger:logs" });
      const logs = task.trigger as unknown as {
        shouldEmit: (topic: string, verbosity: string) => boolean;
      };

      // The old default was an absent filters array, which threw from inside
      // the logging path rather than matching nothing.
      expect(logs.shouldEmit("core.anything", "warn")).to.equal(true);
    });

    it("ignores a line below the default verbosity", async function () {
      const task = await listening({ type: "trigger:logs" });
      const logs = task.trigger as unknown as {
        shouldEmit: (topic: string, verbosity: string) => boolean;
      };

      expect(logs.shouldEmit("core.anything", "info")).to.equal(false);
      expect(logs.shouldEmit("core.anything", "error")).to.equal(true);
    });

    it("lets an explicit minVerbosity beat the default", async function () {
      const task = await listening({
        type: "trigger:logs",
        minVerbosity: "trace",
      });
      const logs = task.trigger as unknown as {
        shouldEmit: (topic: string, verbosity: string) => boolean;
      };

      expect(logs.shouldEmit("core.anything", "info")).to.equal(true);
    });

    it("lets explicit filters beat the default", async function () {
      const task = await listening({
        type: "trigger:logs",
        filters: ["core.runtime.*"],
      });
      const logs = task.trigger as unknown as {
        shouldEmit: (topic: string, verbosity: string) => boolean;
      };

      expect(logs.shouldEmit("core.runtime.tasks.a", "error")).to.equal(true);
      expect(logs.shouldEmit("core.registration.steps", "error")).to.equal(
        false,
      );
    });
  });

  describe("trigger:repeat's interval", function () {
    function repeating(interval: unknown) {
      return new Task(
        {
          trigger: { type: "trigger:repeat", interval, message: "tick" } as any,
          steps: [],
        },
        "repeats",
      ).register();
    }

    for (const interval of [undefined, 0, -1]) {
      it(`is rejected when it is ${interval}`, async function () {
        await expect(repeating(interval), `${interval}`).to.be.rejectedWith(
          /"trigger:repeat"|"interval"/,
        );
      });
    }

    it("names the task it rejected", async function () {
      await expect(repeating(0)).to.be.rejectedWith(/Task "repeats"/);
    });

    it("accepts a duration string and a bare number alike", async function (context) {
      context.mock.timers.enable({ apis: ["setInterval"] });
      const counts: Array<number> = [];

      for (const interval of [1000, "1s"]) {
        const task = new Task(
          {
            trigger: {
              type: "trigger:repeat",
              interval,
              message: "tick",
            } as any,
            steps: [],
          },
          `repeats every ${interval}`,
        );
        // register() already enables the trigger; enabling it again would run
        // two intervals.
        await task.register();

        context.mock.timers.tick(5000);
        counts.push(task.messagesHandled);
        await task.trigger!.disable();
      }

      expect(counts).to.deep.equal([5, 5]);
    });

    it("rejects a duration with no unit or an unknown one", async function () {
      for (const interval of ["5", "5x", "-5m"])
        await expect(repeating(interval), interval).to.be.rejectedWith(
          /"interval"/,
        );
    });
  });

  describe("a trigger's configured message", function () {
    // The config object is reused on every firing, so a transform that mutates
    // the message would otherwise write back into it and the next tick would
    // start from the last one's output.
    it("is not mutated by a transform, tick after tick", async function (context) {
      context.mock.timers.enable({ apis: ["setInterval"] });
      const seen: Array<unknown> = [];
      const trigger = {
        type: "trigger:repeat",
        interval: 1000,
        message: { v: 1, nested: { deep: 1 } },
      };
      const task = new Task(
        {
          trigger: trigger as any,
          steps: [{ type: "transform:offset", path: "v", offset: 1 } as any],
        },
        "does not mutate its config",
      );
      await task.register();
      task.endMessage = async (message) => {
        seen.push(JSON.parse(JSON.stringify(message)));
        return message;
      };

      context.mock.timers.tick(3000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await task.trigger!.disable();

      expect(seen).to.deep.equal([
        { v: 2, nested: { deep: 1 } },
        { v: 2, nested: { deep: 1 } },
        { v: 2, nested: { deep: 1 } },
      ]);
      expect(trigger.message).to.deep.equal({ v: 1, nested: { deep: 1 } });
    });
  });

  describe("trigger:mqtt's topics", function () {
    const connections = [
      { type: "connection:mqtt", name: "broker", endpoint: "mqtt://x" },
    ];

    async function errorsFor(trigger: object) {
      const { validateConfig } = await import("../../src/util/validate.js");

      return validateConfig(
        { connections, tasks: { t: { trigger } } },
        { configPath: "/tmp/x.json" },
      );
    }

    it("is rejected, naming topics as the missing option", async function () {
      const errors = await errorsFor({
        type: "trigger:mqtt",
        connectionName: "broker",
        topic: "alarms/+",
      });

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.trigger.topics",
          message: "missing required option; expected array",
        },
        {
          severity: "warning",
          path: "tasks.t.trigger.topic",
          message: "unknown option for trigger:mqtt",
        },
      ]);
    });

    it("is accepted in its plural form", async function () {
      expect(
        await errorsFor({
          type: "trigger:mqtt",
          connectionName: "broker",
          topics: ["alarms/+"],
        }),
      ).to.deep.equal([]);
    });

    it("is rejected when it is not given at all", async function () {
      const errors = await errorsFor({
        type: "trigger:mqtt",
        connectionName: "broker",
      });

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.trigger.topics",
        message: "missing required option; expected array",
      });
    });
  });

  describe("trigger:infrared", function () {
    it("no longer accepts a ledPin it never transmits on", async function () {
      const { validateConfig } = await import("../../src/util/validate.js");
      const errors = await validateConfig(
        { tasks: { t: { trigger: { type: "trigger:infrared", ledPin: 23 } } } },
        { configPath: "/tmp/x.json" },
      );

      expect(errors).to.deep.include({
        severity: "warning",
        path: "tasks.t.trigger.ledPin",
        message: "unknown option for trigger:infrared",
      });
    });
  });

  describe("a duration", function () {
    it("accepts a unit suffix and rejects an ambiguous or unknown one", async function () {
      const { parseDuration } = await import("../../src/util/duration.js");

      expect(parseDuration("250ms", "interval")).to.equal(250);
      expect(parseDuration("2s", "interval")).to.equal(2000);
      expect(parseDuration("5m", "interval")).to.equal(300000);
      expect(parseDuration("1h", "interval")).to.equal(3600000);
      // A bare number keeps the option's own documented unit.
      expect(parseDuration(1500, "interval")).to.equal(1500);

      for (const bad of ["5", "5x", "-5m"])
        expect(() => parseDuration(bad, "interval"), bad).to.throw(
          /"interval"/,
        );
    });
  });
});
