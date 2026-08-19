import { describe, it, before, beforeEach } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { globals, setGlobals } from "../../src/index.js";
import Task from "../../src/util/Task.js";
import { registerTasks } from "../../src/util/tasks.js";
import Trigger from "../../src/util/Trigger.js";

// Throws for the one message that names itself bad, and hands every other one
// straight back. `${...}` is deliberately absent: generateCode interpolates the
// command before the VM ever sees it.
const FAILS_ON_BAD = {
  type: "transform:javascript",
  outputType: "any",
  command:
    'message === "bad" ? (() => { throw new Error("boom") })() : message',
};

interface CapturedLine {
  log: string;
  verbosity: string;
  topic: string;
  object?: object;
  traceId?: string;
}

describe("failures", function () {
  const captured: Array<CapturedLine> = [];

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
    fatal: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  function errorLines() {
    return captured.filter(({ verbosity }) => verbosity === "error");
  }

  async function registered(config: object, name: string) {
    const task = new Task(config as never, name);
    await task.register();
    globals.tasks.push(task);
    captured.length = 0;

    return task;
  }

  before(function () {
    setGlobals({
      logger: fakeLogger,
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as never);
  });

  beforeEach(async function () {
    for (const task of globals.tasks) await task.trigger?.disable();
    globals.tasks.length = 0;
    captured.length = 0;
  });

  describe("a step that throws", function () {
    it("logs one line under its own topic, naming the trace and the step", async function () {
      const task = await registered(
        { steps: [FAILS_ON_BAD] },
        "fails on its only step",
      );

      await expect(task.startMessage("bad", "a-trace")).to.be.rejectedWith(
        /boom/,
      );

      const step = "core.runtime.tasks.fails on its only step.steps.0";
      expect(errorLines()).to.have.lengthOf(1);
      expect(errorLines()[0].topic).to.equal(step);
      expect(errorLines()[0].traceId).to.equal("a-trace");
      expect(errorLines()[0].object).to.deep.equal({
        task: "fails on its only step",
        step,
        type: "transform:javascript",
        error: { message: "boom", name: "Error" },
      });
    });

    it("names the step that failed, not the first one", async function () {
      const task = await registered(
        { steps: [{ type: "read:constant", value: "bad" }, FAILS_ON_BAD] },
        "fails on its second step",
      );

      await expect(task.startMessage("start", "a-trace")).to.be.rejected;

      expect(errorLines()).to.have.lengthOf(1);
      expect(errorLines()[0].topic).to.equal(
        "core.runtime.tasks.fails on its second step.steps.1",
      );
    });

    // Containment belongs to the trigger, so the promise a programmatic caller
    // holds still reports what happened.
    it("still rejects the promise startMessage handed back", async function () {
      const task = await registered({ steps: [FAILS_ON_BAD] }, "rejects");

      await expect(task.startMessage("bad", "a-trace")).to.be.rejectedWith(
        /boom/,
      );
      expect(task.messagesHandled).to.equal(0);
    });
  });

  describe("a trigger driving a failing chain", function () {
    async function eventTask(name: string, key: string) {
      return registered(
        {
          trigger: { type: "trigger:event", key },
          steps: [
            FAILS_ON_BAD,
            { type: "output:stash", key: "seen", value: "yes" },
          ],
        },
        name,
      );
    }

    it("keeps the message from escaping, and says what became of it", async function () {
      const task = await eventTask("survives a failure", "one");

      await (task.trigger as Trigger).fire(() => "bad", "a-trace");

      const abandoned = errorLines().filter(({ log }) =>
        log.includes("Abandoned message"),
      );
      expect(abandoned).to.have.lengthOf(1);
      expect(abandoned[0].topic).to.equal(
        "core.runtime.tasks.survives a failure.trigger",
      );
      expect(abandoned[0].traceId).to.equal("a-trace");
    });

    it("leaves the task enabled, so the next message still runs", async function () {
      const task = await eventTask("runs again", "two");

      await (task.trigger as Trigger).fire(() => "bad", "a-trace");
      await (task.trigger as Trigger).fire(() => "good", "b-trace");

      expect(task.enabled).to.equal(true);
      expect(task.trigger?.enabled).to.equal(true);
      expect(task.messagesHandled).to.equal(1);
    });

    it("leaves a sibling task untouched", async function () {
      const failing = await eventTask("fails", "three");
      const sibling = await eventTask("unaffected", "four");

      await (failing.trigger as Trigger).fire(() => "bad", "a-trace");
      await (sibling.trigger as Trigger).fire(() => "good", "b-trace");

      expect(failing.messagesHandled).to.equal(0);
      expect(sibling.messagesHandled).to.equal(1);
    });

    // A trigger that builds its message inside its own timer callback throws
    // synchronously, where guarding the returned promise alone would not reach
    // it. structuredClone refuses a function, so cloning the configured message
    // is what fails here.
    it("contains a throw from the trigger's own callback", async function () {
      const task = await registered(
        {
          trigger: {
            type: "trigger:repeat",
            interval: 1,
            message: { uncloneable: () => {} },
          },
          steps: [{ type: "output:stash", key: "seen", value: "yes" }],
        },
        "cannot build its message",
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      await task.trigger?.disable();

      const abandoned = errorLines().filter(({ log }) =>
        log.includes("Abandoned message"),
      );
      expect(abandoned).to.not.have.lengthOf(0);
      expect(abandoned[0].topic).to.equal(
        "core.runtime.tasks.cannot build its message.trigger",
      );
      expect(task.messagesHandled).to.equal(0);
    });
  });

  describe("a rescue", function () {
    // Recovers: hands back a message built out of the failure.
    const SUBSTITUTES = {
      steps: [
        {
          type: "control:return",
          value: { degraded: "${error.message}", from: "${error.type}" },
        },
      ],
    };

    // Reports: falls off its own end, so nothing crosses back.
    const REPORTS = {
      steps: [{ type: "output:stash", key: "reported", value: "yes" }],
    };

    it("substitutes what it returned, and the chain carries on", async function () {
      await registered(SUBSTITUTES, "last-resort");
      const task = await registered(
        {
          rescue: "last-resort",
          steps: [
            FAILS_ON_BAD,
            { type: "output:stash", key: "seen", value: "${message.degraded}" },
            { type: "read:stash", key: "seen" },
          ],
        },
        "recovers",
      );

      expect(await task.startMessage("bad", "a-trace")).to.equal("boom");
      expect(task.messagesHandled).to.equal(1);
    });

    it("ends the message when it returns nothing", async function () {
      const rescue = await registered(REPORTS, "on-failure");
      const task = await registered(
        {
          rescue: "on-failure",
          steps: [
            FAILS_ON_BAD,
            { type: "output:stash", key: "seen", value: "yes" },
          ],
        },
        "reports",
      );

      expect(await task.startMessage("bad", "a-trace")).to.equal(undefined);
      // the rescue ran; the message it was handed did not go any further
      expect(rescue.messagesHandled).to.equal(1);
      expect(task.messagesHandled).to.equal(0);
    });

    it("takes a step's own name over the task's default", async function () {
      await registered(SUBSTITUTES, "last-resort");
      await registered(REPORTS, "on-failure");
      const task = await registered(
        {
          rescue: "on-failure",
          steps: [{ ...FAILS_ON_BAD, rescue: "last-resort" }],
        },
        "overrides",
      );

      expect(await task.startMessage("bad", "a-trace")).to.deep.equal({
        degraded: "boom",
        from: "transform:javascript",
      });
    });

    it("leaves an unrescued step's failure to the caller", async function () {
      const task = await registered({ steps: [FAILS_ON_BAD] }, "no rescue");

      await expect(task.startMessage("bad", "a-trace")).to.be.rejectedWith(
        /boom/,
      );
    });

    it("hands the callee a copy of the caller's stash", async function () {
      await registered(
        { steps: [{ type: "control:return", value: "${stash.device.name}" }] },
        "reads the stash",
      );
      const task = await registered(
        {
          rescue: "reads the stash",
          steps: [
            { type: "output:stash", key: "device", value: { name: "kitchen" } },
            FAILS_ON_BAD,
          ],
        },
        "stashes first",
      );

      expect(await task.startMessage("bad", "a-trace")).to.equal("kitchen");
    });

    // output:stash writes with lodash `set`, so sharing the object -- or
    // shallow-copying it -- would let the callee rewrite a nested object its
    // caller is still holding.
    it("keeps a dotted write in the callee out of the caller's stash", async function () {
      await registered(
        {
          steps: [
            { type: "output:stash", key: "device.name", value: "bathroom" },
            { type: "control:return", value: "recovered" },
          ],
        },
        "rewrites the stash",
      );
      const task = await registered(
        {
          rescue: "rewrites the stash",
          steps: [
            {
              type: "output:stash",
              key: "device",
              value: { name: "kitchen", room: "east" },
            },
            FAILS_ON_BAD,
            { type: "read:stash", key: "device" },
          ],
        },
        "keeps its own stash",
      );

      expect(await task.startMessage("bad", "a-trace")).to.deep.equal({
        name: "kitchen",
        room: "east",
      });
    });

    it("publishes the keys control:return names into the caller", async function () {
      await registered(
        {
          steps: [
            {
              type: "control:return",
              value: "recovered",
              stash: { "failure.reason": "${error.message}" },
            },
          ],
        },
        "publishes a key",
      );
      const task = await registered(
        {
          rescue: "publishes a key",
          steps: [FAILS_ON_BAD, { type: "read:stash", key: "failure" }],
        },
        "reads the published key",
      );

      expect(await task.startMessage("bad", "a-trace")).to.deep.equal({
        reason: "boom",
      });
    });

    it("leaves the callee's own bookkeeping behind", async function () {
      await registered(
        {
          steps: [
            { type: "output:stash", key: "private", value: "bookkeeping" },
            { type: "control:return", value: "recovered" },
          ],
        },
        "keeps notes",
      );
      const task = await registered(
        {
          rescue: "keeps notes",
          steps: [FAILS_ON_BAD, { type: "read:stash", key: "private" }],
        },
        "reads what leaked",
      );

      expect(await task.startMessage("bad", "a-trace")).to.equal(undefined);
    });

    it("ends the message when the rescue itself fails", async function () {
      await registered({ steps: [FAILS_ON_BAD] }, "also fails");
      const task = await registered(
        { rescue: "also fails", steps: [FAILS_ON_BAD] },
        "cannot be rescued",
      );

      expect(await task.startMessage("bad", "a-trace")).to.equal(undefined);

      // the failing step, then the rescue's own failing step, then what
      // became of the message -- and no fourth line, so nothing recursed
      expect(errorLines().map(({ topic }) => topic)).to.deep.equal([
        "core.runtime.tasks.cannot be rescued.steps.0",
        "core.runtime.tasks.also fails.steps.0",
        "core.runtime.tasks.cannot be rescued.steps.0",
      ]);
    });

    it("reports a rescue naming a task that never registered", async function () {
      const task = await registered(
        { rescue: "never-registered", steps: [FAILS_ON_BAD] },
        "names a ghost",
      );

      // The validator rejects this config, so reaching here means the named
      // task failed to register; the failure is uncontained either way.
      await expect(task.startMessage("bad", "a-trace")).to.be.rejectedWith(
        /boom/,
      );
      expect(
        errorLines().some(({ log }) => log.includes("Cannot rescue")),
      ).to.equal(true);
    });
  });

  describe("a task that will not register", function () {
    // trigger:repeat rejects a non-positive interval in register(), which is
    // the earliest a task can fail and the least it can have set up.
    function failingTask(interval: number) {
      return {
        trigger: { type: "trigger:repeat", interval, message: "tick" },
        steps: [{ type: "output:stash", key: "seen", value: "yes" }],
      };
    }

    // A step whose connection is not declared throws from enable(), which is
    // the latest a task can fail: its trigger has already been registered.
    function unconnectedTask(interval: number) {
      return {
        trigger: { type: "trigger:repeat", interval, message: "tick" },
        steps: [
          { type: "output:mqtt", connectionName: "absent", topics: ["a"] },
        ],
      };
    }

    it("leaves the tasks either side of it registered", async function () {
      await registerTasks({
        first: failingTask(50),
        second: failingTask(0),
        third: failingTask(50),
      } as never);

      expect(
        globals.tasks.map(({ name, enabled }) => [name, enabled]),
      ).to.deep.equal([
        ["first", true],
        ["second", false],
        ["third", true],
      ]);
    });

    it("reports the failure under the registration topic, naming the task", async function () {
      await registerTasks({
        first: failingTask(50),
        second: failingTask(0),
      } as never);

      expect(errorLines()).to.have.lengthOf(1);
      expect(errorLines()[0].topic).to.equal("core.registration.tasks");
      expect(errorLines()[0].log).to.include('"second"');
    });

    // cleanUp() reaches a task through globals.tasks, so one that failed
    // partway through has to be in there already.
    it("is still reachable, so what it did arm can be disabled", async function () {
      await registerTasks({
        broken: unconnectedTask(50),
        healthy: failingTask(50),
      } as never);

      const [task] = globals.tasks;
      expect(task.name).to.equal("broken");
      expect(task.enabled).to.equal(false);

      await task.trigger?.disable();
      expect(task.trigger?.enabled).to.equal(false);
    });

    // The steps are enabled before the trigger is armed, so a step that will
    // not enable means no message was ever let in.
    it("never arms its trigger when a step will not enable", async function () {
      await registerTasks({
        broken: unconnectedTask(1),
        healthy: failingTask(50),
      } as never);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(globals.tasks[0].trigger?.enabled).to.equal(false);
      expect(globals.tasks[0].messagesHandled).to.equal(0);
    });

    it("refuses to start when every declared task fails", async function () {
      await expect(
        registerTasks({
          first: failingTask(0),
          second: failingTask(0),
        } as never),
      ).to.be.rejectedWith(/none of the 2 tasks/);
    });

    it("accepts a config that declares no tasks at all", async function () {
      await expect(registerTasks({} as never)).to.not.be.rejected;
      expect(globals.tasks).to.have.lengthOf(0);
    });
  });
});
