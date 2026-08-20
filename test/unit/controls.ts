import { describe, it, before, beforeEach } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { globals, setGlobals } from "../../src/index.js";
import Task from "../../src/util/Task.js";
import { registerTasks } from "../../src/util/tasks.js";

// Throws for the one message that names itself bad, and hands every other one
// straight back, exactly as test/unit/errors.ts uses it.
const FAILS_ON_BAD = {
  type: "transform:javascript",
  outputType: "any",
  command: 'if (message === "bad") throw new Error("boom"); return message;',
};

// Falls off its own end, so nothing crosses back to whatever branched to it.
const NOTES_IT_RAN = {
  steps: [{ type: "output:stash", key: "seen", value: "yes" }],
};

interface CapturedLine {
  log: string;
  verbosity: string;
  topic: string;
}

describe("flow control", function () {
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
    emit: (log: string, verbosity: string, topic: string) => {
      captured.push({ log, verbosity, topic });
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

  describe("a branch", function () {
    it("runs its target when the predicate holds", async function () {
      const target = await registered(NOTES_IT_RAN, "noted");
      const task = await registered(
        {
          steps: [
            {
              type: "control:branch",
              when: "return message > 10",
              task: "noted",
            },
          ],
        },
        "branches when hot",
      );

      expect(await task.startMessage(20, "a-trace")).to.equal(20);
      expect(target.messagesHandled).to.equal(1);
    });

    it("leaves its target alone when the predicate does not hold", async function () {
      const target = await registered(NOTES_IT_RAN, "noted");
      const task = await registered(
        {
          steps: [
            {
              type: "control:branch",
              when: "return message > 10",
              task: "noted",
            },
            { type: "output:stash", key: "after", value: "ran" },
            { type: "read:stash", key: "after" },
          ],
        },
        "branches when hot",
      );

      // The steps after the branch run either way
      expect(await task.startMessage(5, "a-trace")).to.equal("ran");
      expect(target.messagesHandled).to.equal(0);
    });

    it("runs its target every time when `when` is omitted", async function () {
      const target = await registered(NOTES_IT_RAN, "noted");
      const task = await registered(
        { steps: [{ type: "control:branch", task: "noted" }] },
        "branches always",
      );

      await task.startMessage(1, "a-trace");
      await task.startMessage(2, "another-trace");

      expect(target.messagesHandled).to.equal(2);
    });

    it("takes the message a target's control:return names", async function () {
      await registered(
        { steps: [{ type: "control:return", value: "replaced" }] },
        "returns",
      );
      const task = await registered(
        { steps: [{ type: "control:branch", task: "returns" }] },
        "takes the return",
      );

      expect(await task.startMessage("original", "a-trace")).to.equal(
        "replaced",
      );
    });

    it("carries on with what it was handed when its target returns nothing", async function () {
      await registered(NOTES_IT_RAN, "noted");
      const task = await registered(
        { steps: [{ type: "control:branch", task: "noted" }] },
        "keeps its message",
      );

      expect(await task.startMessage("original", "a-trace")).to.equal(
        "original",
      );
    });

    it("publishes the keys its target's control:return names", async function () {
      await registered(
        {
          steps: [
            {
              type: "control:return",
              value: "ignored",
              stash: { "branch.note": "hello" },
            },
          ],
        },
        "publishes a key",
      );
      const task = await registered(
        {
          steps: [
            { type: "control:branch", task: "publishes a key" },
            { type: "read:stash", key: "branch" },
          ],
        },
        "reads the published key",
      );

      expect(await task.startMessage("start", "a-trace")).to.deep.equal({
        note: "hello",
      });
    });

    it("hands ${error...} down when it is taken from inside a rescue", async function () {
      await registered(
        { steps: [{ type: "control:return", value: "${error.message}" }] },
        "names the failure",
      );
      await registered(
        {
          steps: [
            { type: "control:branch", task: "names the failure" },
            { type: "control:return" },
          ],
        },
        "delegates",
      );
      const task = await registered(
        { rescue: "delegates", steps: [FAILS_ON_BAD] },
        "fails and delegates",
      );

      expect(await task.startMessage("bad", "a-trace")).to.equal("boom");
    });

    it("throws when it names no registered task", async function () {
      const task = await registered(
        { steps: [{ type: "control:branch", task: "never-registered" }] },
        "names a ghost",
      );

      // The validator rejects this config, so reaching here means the named
      // task failed to register.
      await expect(task.startMessage("start", "a-trace")).to.be.rejectedWith(
        /Cannot branch/,
      );
    });

    it("reaches its own rescue when it names no registered task", async function () {
      await registered(
        { steps: [{ type: "control:return", value: "recovered" }] },
        "last-resort",
      );
      const task = await registered(
        {
          steps: [
            {
              type: "control:branch",
              task: "never-registered",
              rescue: "last-resort",
            },
          ],
        },
        "rescues a ghost",
      );

      expect(await task.startMessage("start", "a-trace")).to.equal("recovered");
      expect(errorLines()[0].topic).to.equal(
        "core.runtime.tasks.rescues a ghost.steps.0",
      );
    });

    it("reports a failure inside its target under its own topic too", async function () {
      await registered({ steps: [FAILS_ON_BAD] }, "also fails");
      const task = await registered(
        { steps: [{ type: "control:branch", task: "also fails" }] },
        "branches into a failure",
      );

      await expect(task.startMessage("bad", "a-trace")).to.be.rejectedWith(
        /boom/,
      );

      // the target's own failing step logged on the way out, then the step
      // that branched to it
      expect(errorLines().map(({ topic }) => topic)).to.deep.equal([
        "core.runtime.tasks.also fails.steps.0",
        "core.runtime.tasks.branches into a failure.steps.0",
      ]);
    });

    // A typo'd path must not read as "condition not met".
    it("fails the step when its predicate throws", async function () {
      const target = await registered(NOTES_IT_RAN, "noted");
      const task = await registered(
        {
          steps: [
            {
              type: "control:branch",
              when: "return message.nope.deeper",
              task: "noted",
            },
          ],
        },
        "asks a bad question",
      );

      await expect(task.startMessage("start", "a-trace")).to.be.rejected;
      expect(target.messagesHandled).to.equal(0);
      expect(errorLines()[0].topic).to.equal(
        "core.runtime.tasks.asks a bad question.steps.0",
      );
    });
  });

  describe("a stop", function () {
    function stops(when: string | undefined) {
      return {
        steps: [
          { type: "control:stop", ...(when === undefined ? {} : { when }) },
          { type: "output:stash", key: "after", value: "ran" },
          { type: "read:stash", key: "after" },
        ],
      };
    }

    it("ends the chain when the predicate holds", async function () {
      const task = await registered(stops("return message > 10"), "stops hot");

      expect(await task.startMessage(20, "a-trace")).to.equal(undefined);
      expect(task.messagesHandled).to.equal(0);
    });

    it("passes the message on when the predicate does not hold", async function () {
      const task = await registered(stops("return message > 10"), "stops hot");

      expect(await task.startMessage(5, "a-trace")).to.equal("ran");
      expect(task.messagesHandled).to.equal(1);
    });

    it("ends the chain every time when `when` is omitted", async function () {
      const task = await registered(stops(undefined), "always stops");

      expect(await task.startMessage(5, "a-trace")).to.equal(undefined);
      expect(task.messagesHandled).to.equal(0);
    });

    // Dropping a message used to mean throwing, which filed an error line for
    // an ordinary condition.
    it("files no error line for the message it consumed", async function () {
      const task = await registered(stops(undefined), "always stops");

      await task.startMessage(5, "a-trace");

      expect(errorLines()).to.have.lengthOf(0);
    });

    it("fails the step when its predicate throws", async function () {
      const task = await registered(
        stops("return message.nope.deeper"),
        "asks a bad question",
      );

      await expect(task.startMessage("start", "a-trace")).to.be.rejected;
      expect(errorLines()[0].topic).to.equal(
        "core.runtime.tasks.asks a bad question.steps.0",
      );
    });
  });

  describe("a predicate that will not compile", function () {
    it("fails its own task at registration and leaves the others running", async function () {
      await registerTasks({
        broken: { steps: [{ type: "control:stop", when: "return (" }] },
        healthy: NOTES_IT_RAN,
      } as never);

      expect(
        globals.tasks.map(({ name, enabled }) => [name, enabled]),
      ).to.deep.equal([
        ["broken", false],
        ["healthy", true],
      ]);
      expect(errorLines()[0].topic).to.equal("core.registration.tasks");
      expect(errorLines()[0].log).to.include("control:stop");
    });
  });
});
