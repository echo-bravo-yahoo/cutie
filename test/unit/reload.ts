import {
  describe,
  it,
  before,
  beforeEach,
  afterEach,
  mock,
  Mock,
} from "node:test";
import * as realFs from "node:fs";
import * as realFsPromises from "node:fs/promises";
import { normalize } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { createMqttMock } from "../helpers.js";

const CONFIG_PATH = "./examples/imaginary.yaml";
const TOPIC = "cutie/config/test-node";

// A long interval so no tick lands mid-test, and one that a leaked timer would
// hold the process open for: trigger:repeat is the teardown probe here because
// its disable() is the one that has to clear a real timer.
function taskNamed(name: string) {
  return {
    [name]: {
      trigger: { type: "trigger:repeat", interval: 60000, message: name },
      steps: [{ type: "output:console" }],
    },
  };
}

function configWith(name: string) {
  return { connections: [], tasks: taskNamed(name) };
}

const brokerConnection = {
  type: "connection:mqtt",
  name: "broker",
  endpoint: "mqtt://127.0.0.1:1883",
};

// The bootstrap a provider-backed node boots from: it names a provider, so the
// node watches the topic and never the file.
const bootstrapConfig = {
  configProvider: { connectionName: "broker", topic: TOPIC },
  connections: [brokerConnection],
};

describe("picking up a config change without a restart", function () {
  let index: any, globals: any, shutdown: () => Promise<void>;

  // Swapped per test: what reading the local config file yields.
  let localConfig: any;

  const broker = createMqttMock();

  // Every fs.watch this file's runtime opens, so a test can fire the newest
  // one; watch-config re-arms after each burst, so only the last is live.
  const watchListeners: Array<(eventType: string, filename: string) => void> =
    [];

  const infoLines: Array<string> = [];
  const errorLines: Array<string> = [];
  const fatalLines: Array<string> = [];

  let readYaml: Mock<() => Promise<unknown>>;
  let exits: Array<number | undefined>;
  let realExit: typeof process.exit;

  before(async () => {
    readYaml = mock.fn(async () => structuredClone(localConfig));

    // src/util/watch-config.ts binds `watch` and src/util/configs.ts binds
    // `writeFile` at import time, and src/index.ts imports both, so none of
    // these may be imported before the mocks are installed. The real modules
    // are spread back in because other runtime files import other names from
    // them -- src/util/TaskModule.ts wants readFileSync.
    mock.module("node:fs", {
      namedExports: {
        ...realFs,
        watch: (_path: string, second: any, third: any) => {
          watchListeners.push(typeof second === "function" ? second : third);
          return { close: () => {}, unref: () => {} };
        },
      },
    });
    mock.module("node:fs/promises", {
      namedExports: {
        ...realFsPromises,
        // no cache file beside the example config
        writeFile: async () => {},
      },
    });
    mock.module("node-yaml", {
      namedExports: { read: readYaml, readSync: () => ({ version: "test" }) },
    });
    mock.module("mqtt", { defaultExport: broker.mqtt });

    index = await import("../../src/index.js");
    shutdown = (await import("../../src/util/lifecycle.js")).shutdown;

    // start() attaches four signal handlers each time, and every test starts a
    // node; the warning at ten listeners is noise here, not a leak.
    process.setMaxListeners(0);
  });

  beforeEach(() => {
    watchListeners.length = 0;
    infoLines.length = 0;
    errorLines.length = 0;
    fatalLines.length = 0;
    readYaml.mock.resetCalls();
    broker.retainedMessages.clear();
    exits = [];
    realExit = process.exit;
  });

  afterEach(async () => {
    process.exit = realExit;
    // Closes this test's config connection, so its subscription cannot see the
    // next test's publish and reload a runtime that has moved on.
    await shutdown();
  });

  // Starts a node on `local`, then watches what the runtime says about itself.
  async function startNode(local: any) {
    localConfig = local;
    await index.start({ _: [], config: CONFIG_PATH } as never);
    globals = index.globals;

    for (const [level, lines] of [
      ["info", infoLines],
      ["error", errorLines],
      ["fatal", fatalLines],
    ] as const) {
      const original = globals.logger[level].bind(globals.logger);
      globals.logger[level] = (message: string, object?: object) => {
        lines.push(message);
        return original(message, object);
      };
    }
  }

  function reloadCount() {
    return infoLines.filter((line) => line.startsWith("Reloaded config"))
      .length;
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;

    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(
          `Timed out after ${timeoutMs}ms. Info lines so far:\n${infoLines.join("\n")}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  function publish(config: object) {
    return globals.configConnection.connection.publishAsync(
      TOPIC,
      JSON.stringify(config),
      { retain: true },
    );
  }

  function fireWatch() {
    watchListeners[watchListeners.length - 1]("change", "imaginary.yaml");
  }

  it("refuses a config that does not validate, and keeps running", async function (context) {
    context.mock.method(console, "error", () => {});
    await startNode(configWith("a"));
    const original = globals.tasks[0];

    const applied = await index.reload(
      { connections: [], tasks: { bad: { steps: [{ type: "output:hats" }] } } },
      CONFIG_PATH,
    );

    expect(applied).to.equal(false);
    expect(errorLines.join("\n")).to.include("Refusing to reload");
    expect(globals.tasks).to.deep.equal([original]);
    expect(original.trigger.enabled).to.equal(true);
  });

  it("swaps every task and connection for the new config's", async function () {
    await startNode({
      connections: [brokerConnection],
      tasks: taskNamed("a"),
    });
    const original = globals.tasks[0];
    const originalConnection = globals.connections[0];

    expect(await index.reload(configWith("b"), CONFIG_PATH)).to.equal(true);

    expect(original.trigger.enabled).to.equal(false);
    expect(
      original.steps.every((step: { enabled: boolean }) => !step.enabled),
    ).to.equal(true);
    expect(originalConnection.enabled).to.equal(false);
    expect(
      globals.tasks.map((task: { name: string }) => task.name),
    ).to.deep.equal(["b"]);
    expect(globals.connections).to.have.lengthOf(0);
  });

  it("terminates when the new config registers nothing at all", async function () {
    await startNode(configWith("a"));
    process.exit = ((code?: number) => {
      exits.push(code);
    }) as typeof process.exit;

    // Valid against every schema, so validation passes and registration is
    // what refuses it: the script only fails to compile when the task
    // registers.
    await index.reload(
      {
        connections: [],
        tasks: {
          boom: {
            steps: [
              {
                type: "transform:javascript",
                command: "return (",
                outputType: "any",
              },
            ],
          },
        },
      },
      CONFIG_PATH,
    );

    expect(exits).to.deep.equal([1]);
    expect(fatalLines.join("\n")).to.include("registered nothing");
  });

  it("holds the lines a reload writes for the log tasks the new config declares", async function (context) {
    console.log = context.mock.fn(console.log, () => {});
    const printed = (console.log as it.Mock<typeof console.log>).mock;
    await startNode(configWith("a"));
    printed.resetCalls();

    await index.reload(
      {
        connections: [],
        tasks: {
          watcher: {
            trigger: {
              type: "trigger:logs",
              filters: ["core.registration.*"],
              minVerbosity: "info",
            },
            steps: [{ type: "output:console" }],
          },
        },
      },
      CONFIG_PATH,
    );

    // Emitted while the new config's log task did not exist yet, and replayed
    // to it when it registered.
    const lines = printed.calls
      .map((call) => String(call.arguments[0]))
      .join("\n");
    expect(lines).to.include("Registering connections");
  });

  it("watches the topic a provider-backed node's config came from", async function () {
    broker.retainedMessages.set(TOPIC, JSON.stringify(configWith("a")));
    await startNode(bootstrapConfig);

    expect(globals.configConnection).to.not.equal(undefined);
    expect(globals.connections).to.have.lengthOf(0);
    expect(
      globals.tasks.map((task: { name: string }) => task.name),
    ).to.deep.equal(["a"]);

    await publish(configWith("b"));
    await waitFor(() => reloadCount() === 1);

    expect(
      globals.tasks.map((task: { name: string }) => task.name),
    ).to.deep.equal(["b"]);
  });

  it("ignores a retained message identical to the config it is running", async function () {
    const running = configWith("a");
    broker.retainedMessages.set(TOPIC, JSON.stringify(running));
    await startNode(bootstrapConfig);

    // Subscribing redelivered the retained config once already; this is a
    // second copy of the same thing.
    await publish(running);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reloadCount()).to.equal(0);
  });

  it("leaves the config connection open across a reload, and closes it on shutdown", async function () {
    broker.retainedMessages.set(TOPIC, JSON.stringify(configWith("a")));
    await startNode(bootstrapConfig);
    const configConnection = globals.configConnection;

    await publish(configWith("b"));
    await waitFor(() => reloadCount() === 1);

    expect(configConnection.enabled).to.equal(true);
    expect(globals.configConnection).to.equal(configConnection);

    await shutdown();

    expect(configConnection.enabled).to.equal(false);
  });

  it("applies two changes in order rather than interleaving them", async function () {
    broker.retainedMessages.set(TOPIC, JSON.stringify(configWith("a")));
    await startNode(bootstrapConfig);

    await publish(configWith("b"));
    await publish(configWith("c"));
    await waitFor(() => reloadCount() === 2);

    expect(
      infoLines.filter(
        (line) =>
          line.includes("changed; reloading") || line.startsWith("Reloaded"),
      ),
    ).to.deep.equal([
      `Config at "${normalize(CONFIG_PATH)}" changed; reloading.`,
      `Reloaded config at "${normalize(CONFIG_PATH)}".`,
      `Config at "${normalize(CONFIG_PATH)}" changed; reloading.`,
      `Reloaded config at "${normalize(CONFIG_PATH)}".`,
    ]);
    expect(
      globals.tasks.map((task: { name: string }) => task.name),
    ).to.deep.equal(["c"]);
  });

  it("reloads when a local config file with no provider changes", async function () {
    await startNode(configWith("a"));
    expect(watchListeners).to.have.lengthOf(1);

    localConfig = configWith("b");
    fireWatch();
    await waitFor(() => reloadCount() === 1);

    expect(
      globals.tasks.map((task: { name: string }) => task.name),
    ).to.deep.equal(["b"]);
  });

  it("reloads once for a burst of file events, not once per event", async function () {
    await startNode(configWith("a"));
    readYaml.mock.resetCalls();

    localConfig = configWith("b");
    fireWatch();
    fireWatch();
    fireWatch();
    await waitFor(() => reloadCount() === 1);
    // long enough for two more debounce windows to have fired, had they been
    // armed separately
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(reloadCount()).to.equal(1);
    expect(readYaml.mock.callCount()).to.equal(1);
  });
});
