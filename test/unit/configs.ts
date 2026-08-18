import { describe, it, before, beforeEach, mock, Mock } from "node:test";
import { EventEmitter } from "node:events";
import * as realFsPromises from "node:fs/promises";
import { normalize } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import type { ConfigFile } from "../../src/util/configs.js";

const CONFIG_PATH = "./examples/imaginary.yaml";

// A config that names a provider is the only kind that fetches anything; a
// local-only config never reaches the cache at all.
const localConfig = {
  configProvider: { connectionName: "broker", topic: "cutie/config/node" },
  connections: [
    {
      type: "connection:mqtt",
      name: "broker",
      endpoint: "mqtt://127.0.0.1:1883",
    },
  ],
};
const remoteConfig = { connections: [], tasks: [] };
const cachedConfig = { connections: [], tasks: [{ steps: [] }] };

describe("fetching a remote config", function () {
  const warnings: Array<string> = [];
  const errors: Array<string> = [];
  const fakeLogger = {
    logListeners: [] as Array<unknown>,
    emit: () => {},
    info: () => {},
    warn: (message: string) => warnings.push(message),
    error: (message: string) => errors.push(message),
  };

  // Swapped per test: what the broker does, what reading the cache does, and
  // what writing it does.
  let fetchRemote: () => Promise<ConfigFile>;
  let readCache: () => Promise<string>;
  let writeCache: () => Promise<void>;

  let readFile: Mock<(path: string, options?: object) => Promise<string>>,
    writeFile: Mock<
      (path: string, contents: string, options?: object) => Promise<void>
    >,
    readYaml: Mock<(path: string) => Promise<unknown>>,
    fetchConfig: (path: string) => Promise<ConfigFile>,
    globals: { connections: Array<unknown> };

  before(async () => {
    readFile = mock.fn(async () => readCache());
    writeFile = mock.fn(async () => writeCache());
    readYaml = mock.fn(async () => structuredClone(localConfig));

    // src/util/configs.ts binds readFile and writeFile at import time, and
    // src/index.ts imports it, so neither may be imported before this.
    mock.module("node:fs/promises", {
      namedExports: { ...realFsPromises, readFile, writeFile },
    });
    mock.module("node-yaml", {
      namedExports: { read: readYaml, readSync: () => ({ version: "test" }) },
    });

    const index = await import("../../src/index.js");
    index.setGlobals({
      logger: fakeLogger,
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as any);
    globals = index.globals as unknown as typeof globals;

    fetchConfig = (await import("../../src/util/configs.js")).fetchConfig;

    // No broker in a unit test: stand in for the connect/fetch/disconnect
    // lifecycle the provider connection would otherwise perform for real.
    const MQTTConnection = (await import("../../src/connections/mqtt.js"))
      .default;
    mock.method(
      MQTTConnection.prototype,
      "register",
      async function (this: any) {
        this.enabled = true;
      },
    );
    mock.method(MQTTConnection.prototype, "disable", async function () {});
    mock.method(MQTTConnection.prototype, "fetchConfig", async () =>
      fetchRemote(),
    );
  });

  beforeEach(() => {
    warnings.length = 0;
    errors.length = 0;
    globals.connections.length = 0;
    readFile.mock.resetCalls();
    writeFile.mock.resetCalls();
    readYaml.mock.resetCalls();

    fetchRemote = async () => remoteConfig;
    readCache = async () => JSON.stringify(cachedConfig);
    writeCache = async () => {};
  });

  it("uses a local config as-is when it names no provider", async function () {
    readYaml.mock.mockImplementationOnce(async () => ({ connections: [] }));

    expect(await fetchConfig(CONFIG_PATH)).to.deep.equal({ connections: [] });
    expect(writeFile.mock.callCount()).to.equal(0);
    expect(readFile.mock.callCount()).to.equal(0);
  });

  it("caches the config it fetched, beside the local one", async function () {
    const config = await fetchConfig(CONFIG_PATH);

    expect(config).to.deep.equal(remoteConfig);
    expect(writeFile.mock.callCount()).to.equal(1);
    expect(writeFile.mock.calls[0].arguments[0]).to.equal(
      normalize(`${CONFIG_PATH}.cache.json`),
    );
    expect(JSON.parse(writeFile.mock.calls[0].arguments[1])).to.deep.equal(
      remoteConfig,
    );
  });

  it("falls back to the cached copy when the fetch fails", async function () {
    fetchRemote = async () => {
      throw new Error("the broker is down");
    };

    const config = await fetchConfig(CONFIG_PATH);

    expect(config).to.deep.equal(cachedConfig);
    expect(readFile.mock.calls[0].arguments[0]).to.equal(
      normalize(`${CONFIG_PATH}.cache.json`),
    );
    // the fallback is loud, and says what it fell back from
    expect(errors.join("\n")).to.include("FALLING BACK");
    expect(errors.join("\n")).to.include("the broker is down");
  });

  it("reports why the fetch failed, not why the cache was unreadable", async function () {
    fetchRemote = async () => {
      throw new Error("the broker is down");
    };
    readCache = async () => {
      throw new Error("ENOENT: no such file or directory");
    };

    await expect(fetchConfig(CONFIG_PATH)).to.be.rejectedWith(
      /the broker is down/,
    );
  });

  it("only warns when the cache cannot be written", async function () {
    writeCache = async () => {
      throw new Error("read-only file system");
    };

    // a node that cannot cache should still run on what it just fetched
    expect(await fetchConfig(CONFIG_PATH)).to.deep.equal(remoteConfig);
    expect(warnings.join("\n")).to.include("read-only file system");
    expect(errors).to.have.lengthOf(0);
  });
});
