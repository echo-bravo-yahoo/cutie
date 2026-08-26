import { describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, setGlobals } from "../../src/index.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import { ProvidingConnection } from "../../src/util/Connection.js";
import { ConfigFile } from "../../src/util/configs.js";
import { parseServeUIArgs } from "../../src/cli/serve-ui.js";
import { discoverNodes, publishNode } from "../../src/web/mqtt-bridge.js";
import { startServer } from "../../src/web/server.js";
import { knownOutputTopics } from "../../src/web/topics.js";

const fakeLogger = {
  emit: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logListeners: [] as Array<unknown>,
  addListener(listener: unknown) {
    this.logListeners.push(listener);
  },
  removeListener(listener: unknown) {
    const index = this.logListeners.indexOf(listener);
    if (index !== -1) this.logListeners.splice(index, 1);
  },
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

// A stand-in broker just real enough for startServer's own setup
// (startLiveFeed's "message" listener and "#" subscription) -- this suite
// never actually publishes anything to it.
class FakeBroker extends EventEmitter {
  options = { clientId: "web-test" };
  async subscribeAsync() {}
  async endAsync() {}
}

describe("parseServeUIArgs", function () {
  it("parses connectionName, topic, and host as strings and port as a number", function () {
    const args = parseServeUIArgs([
      "serve-ui",
      "--connectionName",
      "my-broker",
      "--topic",
      "cutie/config/+",
      "--host",
      "0.0.0.0",
      "--port",
      "8080",
    ]);

    expect(args.connectionName).to.equal("my-broker");
    expect(args.topic).to.equal("cutie/config/+");
    expect(args.host).to.equal("0.0.0.0");
    expect(args.port).to.equal(8080);
  });

  it("leaves topic, host, and port undefined when not given, for serveUI to default", function () {
    const args = parseServeUIArgs([
      "serve-ui",
      "--connectionName",
      "my-broker",
    ]);

    expect(args.topic).to.equal(undefined);
    expect(args.host).to.equal(undefined);
    expect(args.port).to.equal(undefined);
  });
});

describe("the web UI's mqtt bridge", function () {
  function fakeConnection() {
    const fetchAllConfigs = mock.fn(async () => ({}));
    const uploadSingleConfig = mock.fn(async () => {});
    const connection = {
      fetchAllConfigs,
      uploadSingleConfig,
    } as unknown as ProvidingConnection;

    return { connection, fetchAllConfigs, uploadSingleConfig };
  }

  describe("discoverNodes", function () {
    it("collects over a longer window than fetchAllConfigs' own default", async function () {
      const { connection, fetchAllConfigs } = fakeConnection();

      await discoverNodes(connection, "cutie/config/+");

      expect(fetchAllConfigs.mock.calls[0].arguments).to.deep.equal([
        "cutie/config/+",
        1500,
      ]);
    });
  });

  describe("publishNode", function () {
    const validConfig = {
      connections: [],
      tasks: {},
    } as unknown as ConfigFile;
    const invalidConfig = {
      connections: "not an array",
      tasks: {},
    } as unknown as ConfigFile;

    it("publishes and reports warnings when the config is valid", async function () {
      const { connection, uploadSingleConfig } = fakeConnection();

      const result = await publishNode(connection, "bob", validConfig);

      expect(result.ok).to.equal(true);
      expect(result.errors).to.equal(undefined);
      expect(uploadSingleConfig.mock.calls[0].arguments).to.deep.equal([
        "bob",
        validConfig,
        undefined,
      ]);
    });

    it("refuses to publish and reports errors when the config is invalid", async function () {
      const { connection, uploadSingleConfig } = fakeConnection();

      const result = await publishNode(connection, "bob", invalidConfig);

      expect(result.ok).to.equal(false);
      expect(result.errors?.length).to.be.greaterThan(0);
      expect(uploadSingleConfig.mock.calls.length).to.equal(0);
    });
  });
});

describe("knownOutputTopics", function () {
  it("collects every literal output:mqtt topic across every task", function () {
    const config = {
      connections: [],
      tasks: {
        weather: {
          steps: [
            { type: "output:mqtt", topics: ["home/weather"] },
            { type: "output:console" },
          ],
        },
        clock: {
          steps: [{ type: "output:mqtt", topics: ["home/clock", "home/time"] }],
        },
      },
    } as unknown as ConfigFile;

    expect(knownOutputTopics(config).sort()).to.deep.equal([
      "home/clock",
      "home/time",
      "home/weather",
    ]);
  });

  it("excludes a templated topic as unresolvable", function () {
    const config = {
      connections: [],
      tasks: {
        weather: {
          steps: [
            {
              type: "output:mqtt",
              topics: ["home/weather", "home/${message.room}"],
            },
          ],
        },
      },
    } as unknown as ConfigFile;

    expect(knownOutputTopics(config)).to.deep.equal(["home/weather"]);
  });

  it("returns nothing for a config with no output:mqtt steps", function () {
    const config = { connections: [], tasks: {} } as unknown as ConfigFile;

    expect(knownOutputTopics(config)).to.deep.equal([]);
  });
});

describe("startServer's SPA fallback", function () {
  it("serves index.html for a nested client-side route, even when an ancestor directory starts with a dot", async function () {
    useFakeGlobals();

    // A dot-prefixed ancestor directory mimics running cutie from inside one
    // (a git worktree under .claude/worktrees/, for instance) -- send's
    // dotfile check used to 404 the SPA fallback whenever any segment of the
    // resolved *absolute* path started with a dot.
    const base = await mkdtemp(join(tmpdir(), "cutie-web-test-"));
    const distDir = join(base, ".dotdir", "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(
      join(distDir, "index.html"),
      '<!doctype html><div id="root">spa-fallback-marker</div>',
    );

    const connection = new MQTTConnection({
      type: "connection:mqtt",
      name: "web-test",
      endpoint: "mqtt://127.0.0.1:1883",
    } as never);
    connection.connection = new FakeBroker() as never;
    connection.enabled = true;

    const httpServer = await startServer({
      connection,
      port: 0,
      host: "127.0.0.1",
      distDir,
    });

    try {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/node/some-node`);
      expect(res.status).to.equal(200);
      expect(await res.text()).to.include("spa-fallback-marker");
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await connection.disable();
      await rm(base, { recursive: true, force: true });
    }
  });
});
