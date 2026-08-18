import { before, describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, globals, setGlobals, start } from "../../src/index.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import InfluxDBConnection from "../../src/connections/influxdb.js";
import { registerConnections } from "../../src/util/connections.js";
import Task from "../../src/util/Task.js";
import { validateConfig } from "../../src/util/validate.js";

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

function useFakeGlobals() {
  setGlobals({
    tasks: [],
    connections: [],
    version: "test",
    logger: fakeLogger,
    eventBus: new EventEmitter(),
    configDir: process.cwd(),
  } as unknown as Globals);
}

// An MQTT connection with a stubbed client, so subscribe bookkeeping and message
// routing can be observed without a broker.
function stubbedConnection(name: string) {
  const connection = new MQTTConnection({
    type: "connection:mqtt",
    name,
    endpoint: "mqtt://127.0.0.1:1883",
  } as never);

  connection.connection = {
    options: { clientId: `${name}_client` },
    subscribeAsync: async () => {},
    unsubscribeAsync: async () => {},
  } as never;
  connection.enabled = true;

  return connection;
}

async function triggerBoundTo(connectionName: string, topic: string) {
  const task = new Task(
    {
      trigger: {
        type: "trigger:mqtt",
        connectionName,
        topics: [topic],
      } as never,
      steps: [],
    },
    `listens on ${connectionName}/${topic}`,
  );
  await task.register();
  globals.tasks.push(task);

  return task;
}

describe("connections", function () {
  before(function () {
    useFakeGlobals();
  });

  describe("routing a message to the right trigger", function () {
    it("ignores a trigger bound to another connection", async function () {
      useFakeGlobals();
      const a = stubbedConnection("a");
      const b = stubbedConnection("b");
      globals.connections.push(a, b);

      const task = await triggerBoundTo("b", "x");

      a.handleMessage("x", Buffer.from('{"from":"a"}'), {} as never);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(task.messagesHandled, "after a delivered").to.equal(0);

      b.handleMessage("x", Buffer.from('{"from":"b"}'), {} as never);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(task.messagesHandled, "after b delivered").to.equal(1);
    });

    it("fires when its own connection is the only one", async function () {
      useFakeGlobals();
      const b = stubbedConnection("b");
      globals.connections.push(b);

      const task = await triggerBoundTo("b", "x");

      b.handleMessage("x", Buffer.from("{}"), {} as never);
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(task.messagesHandled).to.equal(1);
    });

    it("keeps two triggers on the same topic apart", async function () {
      useFakeGlobals();
      const a = stubbedConnection("a");
      const b = stubbedConnection("b");
      globals.connections.push(a, b);

      const onA = await triggerBoundTo("a", "shared");
      const onB = await triggerBoundTo("b", "shared");

      a.handleMessage("shared", Buffer.from("{}"), {} as never);
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect([onA.messagesHandled, onB.messagesHandled]).to.deep.equal([1, 0]);
    });
  });

  describe("a disabled connection", function () {
    it("opens no socket", async function () {
      useFakeGlobals();
      const registered = mock.method(
        MQTTConnection.prototype,
        "register",
        async () => {},
      );

      await registerConnections([
        {
          type: "connection:mqtt",
          name: "off",
          endpoint: "mqtt://127.0.0.1:1883",
          disabled: true,
        } as never,
      ]);

      expect(registered.mock.callCount()).to.equal(0);
      // Still listed, so a step naming it can be told why it cannot use it.
      expect(globals.connections.map((entry) => entry.name)).to.deep.equal([
        "off",
      ]);
      registered.mock.restore();
    });

    it("is reported differently from one that does not exist", async function () {
      const errors = await validateConfig(
        {
          connections: [
            {
              type: "connection:mqtt",
              name: "off",
              endpoint: "mqtt://x",
              disabled: true,
            },
          ],
          tasks: {
            t: {
              steps: [
                { type: "output:mqtt", connectionName: "off", topics: ["a"] },
                {
                  type: "output:mqtt",
                  connectionName: "absent",
                  topics: ["a"],
                },
              ],
            },
          },
        },
        { configPath: "/tmp/x.json" },
      );

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].connectionName",
        message: 'connection "off" is declared but disabled',
      });
      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[1].connectionName",
        message: 'no connection named "absent" is declared',
      });
    });
  });

  describe("a connection's own options", function () {
    it("reports the dead enabled key as unknown", async function () {
      const errors = await validateConfig(
        {
          connections: [
            {
              type: "connection:mqtt",
              name: "a",
              endpoint: "mqtt://x",
              enabled: true,
            },
          ],
        },
        { configPath: "/tmp/x.json" },
      );

      expect(errors).to.deep.include({
        severity: "warning",
        path: "connections[0].enabled",
        message: "unknown option for connection:mqtt",
      });
    });

    it("requires an endpoint", async function () {
      const errors = await validateConfig(
        { connections: [{ type: "connection:mqtt", name: "a" }] },
        { configPath: "/tmp/x.json" },
      );

      expect(errors).to.deep.include({
        severity: "error",
        path: "connections[0].endpoint",
        message: "missing required option; expected string",
      });
    });
  });

  describe("registration", function () {
    it("enables every connection it registers", async function () {
      useFakeGlobals();
      const enabled = mock.method(InfluxDBConnection.prototype, "enable");

      await registerConnections([
        {
          type: "connection:influxdb",
          name: "influx",
          url: "http://127.0.0.1:8086",
          organization: "home",
          bucket: "sensors",
          token: "t",
        } as never,
      ]);

      expect(enabled.mock.callCount()).to.equal(1);
      expect(globals.connections[0].enabled).to.equal(true);
      enabled.mock.restore();
    });
  });

  describe("fetching a remote config", function () {
    let directory: string;

    before(async function () {
      directory = await mkdtemp(join(tmpdir(), "cutie-remote-"));
    });

    async function configNaming(name: string, cached?: object) {
      const path = join(directory, `${name}.conf.json`);
      await writeFile(
        path,
        JSON.stringify({
          configProvider: {
            connectionName: "broker",
            topic: "cutie/config/me",
          },
          connections: [
            {
              type: "connection:mqtt",
              name: "broker",
              endpoint: "mqtt://127.0.0.1:1883",
            },
          ],
          tasks: {},
        }),
      );

      if (cached) await writeFile(`${path}.cache.json`, JSON.stringify(cached));

      return path;
    }

    it("falls back to the cache when no retained message arrives", async function (context) {
      context.mock.method(console, "error", () => {});
      const path = await configNaming("with-cache", {
        connections: [],
        tasks: { cached: { steps: [{ type: "output:console" }] } },
      });
      // The fetch has to give up rather than wait forever, which is the whole
      // reason the cache is reachable at all.
      context.mock.method(MQTTConnection.prototype, "fetchConfig", async () => {
        throw new Error(
          'Timed out after 10000ms waiting for a retained config message on MQTT topic "cutie/config/me".',
        );
      });
      context.mock.method(MQTTConnection.prototype, "register", async () => {});
      context.mock.method(MQTTConnection.prototype, "disable", async () => {});

      const result = await start({ _: [], config: path } as never);

      expect(result.tasks.map((task) => task.name)).to.deep.equal(["cached"]);
    });

    it("names the topic and the timeout when there is no cache either", async function (context) {
      const path = await configNaming("no-cache");
      context.mock.method(MQTTConnection.prototype, "fetchConfig", async () => {
        throw new Error(
          'Timed out after 10000ms waiting for a retained config message on MQTT topic "cutie/config/me".',
        );
      });
      context.mock.method(MQTTConnection.prototype, "register", async () => {});
      context.mock.method(MQTTConnection.prototype, "disable", async () => {});

      await expect(start({ _: [], config: path } as never)).to.be.rejectedWith(
        /Timed out after 10000ms.*cutie\/config\/me.*could not read the cached copy/s,
      );
    });

    it("leaves no bootstrap connection behind after the fallback", async function (context) {
      context.mock.method(console, "error", () => {});
      const path = await configNaming("cleans-up", {
        connections: [],
        tasks: {},
      });
      context.mock.method(MQTTConnection.prototype, "fetchConfig", async () => {
        throw new Error("no retained message");
      });
      context.mock.method(MQTTConnection.prototype, "register", async () => {});
      context.mock.method(MQTTConnection.prototype, "disable", async () => {});

      const result = await start({ _: [], config: path } as never);

      expect(result.connections).to.deep.equal([]);
    });

    it("takes the same fallback for a retained message that is not JSON", async function (context) {
      context.mock.method(console, "error", () => {});
      const path = await configNaming("bad-json", {
        connections: [],
        tasks: { fromCache: { steps: [] } },
      });
      context.mock.method(MQTTConnection.prototype, "fetchConfig", async () => {
        throw new Error(
          'The retained message on MQTT topic "cutie/config/me" is not valid JSON: Unexpected token.',
        );
      });
      context.mock.method(MQTTConnection.prototype, "register", async () => {});
      context.mock.method(MQTTConnection.prototype, "disable", async () => {});

      const result = await start({ _: [], config: path } as never);

      expect(result.tasks.map((task) => task.name)).to.deep.equal([
        "fromCache",
      ]);
    });

    it("cleans up the temp directory", async function () {
      await rm(directory, { recursive: true, force: true });
    });
  });
});

// "mqtt" can only be mocked once per process, and this file's other tests
// either stub the client directly or stub register(), so the one mock here is
// the always-refusing one this suite needs.
describe("registerConnections", function () {
  before(() => {
    mock.module("mqtt", {
      defaultExport: {
        connectAsync: async () => {
          throw Object.assign(
            new Error("connect ECONNREFUSED 127.0.0.1:1883"),
            {
              code: "ECONNREFUSED",
            },
          );
        },
      },
    });
  });

  it("logs a connection failure instead of crashing, and still resolves", async function () {
    const emitted: Array<{ message: string; verbosity: string }> = [];
    const errored: Array<{ message: string; object?: object }> = [];
    setGlobals({
      logger: {
        emit: (message: string, verbosity: string) =>
          emitted.push({ message, verbosity }),
        error: (message: string, object?: object) =>
          errored.push({ message, object }),
        logListeners: [],
      },
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as never);

    await expect(
      registerConnections([
        {
          type: "connection:mqtt",
          name: "broker",
          endpoint: "mqtt://127.0.0.1:1883",
        } as never,
      ]),
    ).to.not.be.rejected;

    expect(
      emitted.some(
        (line) => line.verbosity === "error" && line.message.includes("broker"),
      ),
    ).to.equal(true);

    // Connections register before tasks, so no trigger:logs listener can be
    // active yet -- emit() alone would be invisible on a real run. This
    // asserts the direct-pino fallback fires too.
    expect(errored.some((line) => line.message.includes("broker"))).to.equal(
      true,
    );
  });
});
