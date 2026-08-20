import { describe, it, before, beforeEach } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { globals, setGlobals } from "../../src/index.js";
import { setupProcess } from "../../src/process.js";
import { shutdown, teardown } from "../../src/util/lifecycle.js";

interface FakeProcess extends EventEmitter {
  pid: number;
  exitCode?: number;
  exits: Array<number>;
  exit: (code: number) => void;
}

// Enough of NodeJS.Process for setupProcess: an emitter carrying a pid, an
// exitCode to be set, and an exit() that records rather than ends the run.
function fakeProcess(): FakeProcess {
  const process = new EventEmitter() as FakeProcess;

  process.pid = 4242;
  process.exitCode = undefined;
  process.exits = [];
  process.exit = (code: number) => {
    process.exits.push(code);
  };

  return process;
}

describe("a signalled shutdown", function () {
  const fakeLogger = {
    logListeners: [] as Array<unknown>,
    addListener(listener: unknown) {
      this.logListeners.push(listener);
    },
    removeListener(listener: unknown) {
      const index = this.logListeners.indexOf(listener);
      if (index !== -1) this.logListeners.splice(index, 1);
    },
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };

  // Every trigger, step and connection records the fact that it was disabled,
  // which is the whole contract teardown() has with them.
  const disabled: Array<string> = [];

  function recorder(label: string, failing = false) {
    return {
      disable: async () => {
        if (failing) throw new Error(`${label} would not stop`);
        disabled.push(label);
      },
    };
  }

  function populateGlobals({ failingStep = false } = {}) {
    globals.tasks.push({
      trigger: recorder("trigger"),
      steps: [recorder("step 0", failingStep), recorder("step 1")],
    } as any);
    globals.tasks.push({
      // a task may have no trigger at all
      trigger: undefined,
      steps: [recorder("second task's step")],
    } as any);
    globals.connections.push(recorder("connection") as any);
    globals.configConnection = recorder("config connection") as any;
  }

  // Fires one handler and lets cleanUp's promises settle. Nothing here waits
  // on a timer: the forced-exit watchdog is unref'd and two seconds out.
  async function signal(event: string, argument?: unknown) {
    const process = fakeProcess();
    setupProcess(process as unknown as NodeJS.Process);

    process.emit(event, argument);
    await new Promise((resolve) => setImmediate(resolve));

    return process;
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
    disabled.length = 0;
    globals.tasks.length = 0;
    globals.connections.length = 0;
    globals.configConnection = undefined;
  });

  it("disables every trigger, step and connection on SIGTERM", async function () {
    populateGlobals();

    await signal("SIGTERM", "SIGTERM");

    expect(disabled.sort()).to.deep.equal([
      "config connection",
      "connection",
      "second task's step",
      "step 0",
      "step 1",
      "trigger",
    ]);
  });

  it("treats a signalled stop as a clean stop", async function () {
    populateGlobals();

    const process = await signal("SIGTERM", "SIGTERM");

    expect(process.exitCode).to.equal(0);
    // the event loop is left to drain on its own, so pino can flush; exit() is
    // only the watchdog, two seconds later
    expect(process.exits).to.deep.equal([]);
  });

  it("shuts down the same way on SIGINT", async function () {
    populateGlobals();

    const process = await signal("SIGINT", "SIGINT");

    expect(disabled).to.have.lengthOf(6);
    expect(process.exitCode).to.equal(0);
    expect(process.exits).to.deep.equal([]);
  });

  it("exits non-zero after an uncaught exception", async function () {
    populateGlobals();

    const process = await signal("uncaughtException", new Error("boom"));

    expect(disabled).to.have.lengthOf(6);
    expect(process.exitCode).to.equal(1);
  });

  it("keeps disabling the rest when one step refuses to stop", async function () {
    populateGlobals({ failingStep: true });

    const process = await signal("SIGTERM", "SIGTERM");

    expect(disabled).to.not.include("step 0");
    expect(disabled.sort()).to.deep.equal([
      "config connection",
      "connection",
      "second task's step",
      "step 1",
      "trigger",
    ]);
    expect(process.exitCode).to.equal(0);
  });

  // The split the reload depends on: a reload runs teardown and has to still
  // be subscribed to the topic that will carry the next config.
  it("leaves the config connection alone when only tearing down", async function () {
    populateGlobals();

    await teardown();

    expect(disabled).to.not.include("config connection");
    expect(disabled).to.have.lengthOf(5);
  });

  it("closes the config connection on a full shutdown", async function () {
    populateGlobals();

    await shutdown();

    expect(disabled).to.include("config connection");
  });
});
