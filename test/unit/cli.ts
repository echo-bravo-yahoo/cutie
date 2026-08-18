import { describe, it, before, after, afterEach, Mock, mock } from "node:test";
import * as realFsPromises from "node:fs/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { read } from "node-yaml";

import { setGlobals } from "../../src/index.js";
import * as realConfigs from "../../src/util/configs.js";
import type { fetchConfig } from "../../src/util/configs.js";
import type { writeFile } from "fs";
import { Connection } from "../../src/util/Connection.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import { DownloadArgs } from "../../src/cli/download.js";
import { UploadArgs } from "../../src/cli/upload.js";

// Stands in for a node:fs Dirent from readdir({withFileTypes, recursive}),
// where name is a bare basename and parentPath is the directory it came from.
function fakeDirEnt(parentPath: string, name: string, isFile = true) {
  return { name, parentPath, isFile: () => isFile };
}

describe("the CLI's", function () {
  const fakeLogger = {
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  const remoteConfig = { connections: [], tasks: [] };
  const remoteConfig2 = {
    connections: [{ type: "connection:mqtt", name: "test" }],
    tasks: [],
  };

  // What uploadAll should find: two extensions at the top level, one nested,
  // and two entries it must skip.
  const uploadDirEnts = [
    fakeDirEnt("./configs", "bob.conf.json"),
    fakeDirEnt("./configs", "thing.yaml"),
    fakeDirEnt("./configs/nested", "deep.yml"),
    fakeDirEnt("./configs", "notes.txt"),
    fakeDirEnt("./configs", "nested", false),
  ];

  let mockFetchConfig: Mock<typeof fetchConfig>,
    mockWriteFile: Mock<typeof writeFile>,
    mockReaddir: Mock<typeof realFsPromises.readdir>,
    mockReadYaml: Mock<(path: string) => Promise<unknown>>,
    mockFetchSingleConfig: Mock<Connection["fetchSingleConfig"]>,
    mockFetchAllConfigs: Mock<Connection["fetchAllConfigs"]>,
    mockUploadSingleConfig: Mock<Connection["uploadSingleConfig"]>,
    download: (args: DownloadArgs) => Promise<any>,
    upload: (args: UploadArgs) => Promise<any>;

  before(async () => {
    setGlobals({ logger: fakeLogger } as any);

    mockFetchConfig = mock.fn(async function () {
      return {
        connections: [
          {
            type: "connection:mqtt",
            name: "test",
          },
        ],
      };
    });
    mockWriteFile = mock.fn(async function () {}) as unknown as Mock<
      typeof writeFile
    >;
    mockReadYaml = mock.fn(async (path: string) =>
      path.includes("thing") ? remoteConfig2 : remoteConfig,
    );
    // registerConnections lists src/connections with readdir too, so only the
    // upload directory listing is faked.
    mockReaddir = mock.fn(async (path: any, options?: any) => {
      if (String(path).endsWith("connections"))
        return realFsPromises.readdir(path, options);
      return uploadDirEnts;
    }) as unknown as Mock<typeof realFsPromises.readdir>;

    mockFetchSingleConfig = mock.fn(async () => remoteConfig);
    mockFetchAllConfigs = mock.fn(async () => ({
      bob: remoteConfig,
      chicken: remoteConfig2,
    }));
    mockUploadSingleConfig = mock.fn(async () => {});

    // Only the fetch is stubbed; the node-name derivations are the real ones,
    // since the round trip they guarantee is what these tests are about.
    mock.module("../../src/util/configs.js", {
      namedExports: {
        ...realConfigs,
        fetchConfig: mockFetchConfig,
      },
    });
    mock.module("node:fs/promises", {
      namedExports: {
        ...realFsPromises,
        writeFile: mockWriteFile,
        readdir: mockReaddir,
      },
    });
    mock.module("node-yaml", {
      namedExports: { read: mockReadYaml },
    });

    // No broker in a unit test: stand in for the connect/disconnect lifecycle
    // that register() and disable() would otherwise perform for real.
    mock.method(
      MQTTConnection.prototype,
      "register",
      async function (this: any) {
        this.enabled = true;
      },
    );
    mock.method(MQTTConnection.prototype, "disable", async function () {});
    mock.method(
      MQTTConnection.prototype,
      "fetchSingleConfig",
      mockFetchSingleConfig,
    );
    mock.method(
      MQTTConnection.prototype,
      "fetchAllConfigs",
      mockFetchAllConfigs,
    );
    mock.method(
      MQTTConnection.prototype,
      "uploadSingleConfig",
      mockUploadSingleConfig,
    );

    download = (await import("../../src/cli/download.js")).default;
    upload = (await import("../../src/cli/upload.js")).default;
  });

  afterEach(() => {
    mockFetchConfig.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockReaddir.mock.resetCalls();
    mockReadYaml.mock.resetCalls();
    mockFetchSingleConfig.mock.resetCalls();
    mockFetchAllConfigs.mock.resetCalls();
    mockUploadSingleConfig.mock.resetCalls();
  });

  describe("download command", async function () {
    it('can download one file from the default MQTT location, "cutie/config/$node" to the default path "."', async function () {
      await download({
        connectionName: "test",
        config: "./cutie.conf.yaml",
        node: "bob",
      });
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
      expect(mockFetchSingleConfig.mock.calls[0].arguments).to.deep.equal([
        "bob",
        undefined,
      ]);
    });

    it('can download one file from the default MQTT location, "cutie/config/$node" to a non-default path', async function () {
      await download({
        connectionName: "test",
        node: "bob",
        path: "./somewhere/else",
      });
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "somewhere/else/bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
      expect(mockFetchSingleConfig.mock.calls[0].arguments).to.deep.equal([
        "bob",
        undefined,
      ]);
    });

    it('can download multiple files from the default MQTT location, "cutie/config/$node" to the default path "."', async function () {
      await download({
        connectionName: "test",
      });
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
      expect(mockWriteFile.mock.calls[1].arguments).to.deep.equal([
        "chicken.conf.json",
        JSON.stringify(remoteConfig2, null, 4),
      ]);
    });

    it('can download multiple files from the default MQTT location, "cutie/config/$node" to a non-default path', async function () {
      await download({
        connectionName: "test",
        path: "./somewhere/else",
      });
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "somewhere/else/bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
      expect(mockWriteFile.mock.calls[1].arguments).to.deep.equal([
        "somewhere/else/chicken.conf.json",
        JSON.stringify(remoteConfig2, null, 4),
      ]);
    });

    it('can download one file from a non-default MQTT location to the default path "."', async function () {
      await download({
        connectionName: "test",
        node: "bob",
        topic: "mything/config/+",
      });
      expect(mockFetchSingleConfig.mock.calls[0].arguments).to.deep.equal([
        "bob",
        "mything/config/+",
      ]);
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
    });

    it("can download one file from a non-default MQTT location to a non-default path", async function () {
      await download({
        connectionName: "test",
        node: "bob",
        path: "./somewhere/else",
        topic: "mything/config/+",
      });
      expect(mockFetchSingleConfig.mock.calls[0].arguments).to.deep.equal([
        "bob",
        "mything/config/+",
      ]);
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "somewhere/else/bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
    });

    it('can download multiple files from a non-default MQTT location to the default path "."', async function () {
      await download({
        connectionName: "test",
        topic: "mything/config/+",
      });
      expect(mockFetchAllConfigs.mock.calls[0].arguments).to.deep.equal([
        "mything/config/+",
      ]);
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
    });

    it("can download multiple files from a non-default MQTT location to a non-default path", async function () {
      await download({
        connectionName: "test",
        path: "./somewhere/else",
        topic: "mything/config/+",
      });
      expect(mockFetchAllConfigs.mock.calls[0].arguments).to.deep.equal([
        "mything/config/+",
      ]);
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "somewhere/else/bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
    });
  });

  describe("upload command", function () {
    it("uploads every json, yaml, and yml file, including nested ones", async function () {
      await upload({
        connectionName: "test",
        path: "./configs",
      } as UploadArgs);

      const uploaded = mockUploadSingleConfig.mock.calls.map(
        (call) => call.arguments[0],
      );
      // "bob.conf.json" is the name download writes, so it has to come back as
      // the node name "bob" and not as "bob.conf".
      expect(uploaded.sort()).to.deep.equal(["bob", "deep", "thing"]);
    });

    it("skips files that are not config-like and skips directories", async function () {
      await upload({
        connectionName: "test",
        path: "./configs",
      } as UploadArgs);

      const uploaded = mockUploadSingleConfig.mock.calls.map(
        (call) => call.arguments[0],
      );
      expect(uploaded).to.not.include("notes");
      expect(uploaded).to.not.include("nested");
    });

    it("reads a nested file from its own parent directory", async function () {
      await upload({
        connectionName: "test",
        path: "./configs",
      } as UploadArgs);

      const readPaths = mockReadYaml.mock.calls.map(
        (call) => call.arguments[0],
      );
      expect(readPaths).to.include(join("./configs/nested", "deep.yml"));
    });

    it("uploads a single node to a non-default topic", async function () {
      await upload({
        connectionName: "test",
        path: "./configs/bob.conf.json",
        node: "bob",
        topic: "mything/config/+",
      } as UploadArgs);

      expect(mockUploadSingleConfig.mock.calls[0].arguments[0]).to.equal("bob");
      expect(mockUploadSingleConfig.mock.calls[0].arguments[2]).to.equal(
        "mything/config/+",
      );
    });
  });

  // download names the file and upload reads the node name back out of it, so
  // the two derivations are one function and this is what it guarantees.
  describe("node names", function () {
    it("survives every config extension", function () {
      for (const [file, node] of [
        ["kitchen-pi.conf.json", "kitchen-pi"],
        ["kitchen-pi.json", "kitchen-pi"],
        ["kitchen-pi.yaml", "kitchen-pi"],
        ["kitchen-pi.yml", "kitchen-pi"],
        ["nested/kitchen-pi.conf.json", "kitchen-pi"],
      ] as const)
        expect(realConfigs.nodeNameFromPath(file), file).to.equal(node);
    });

    it("does not empty out a file called conf.json", function () {
      expect(realConfigs.nodeNameFromPath("conf.json")).to.equal("conf");
    });

    it("round-trips through the name download writes", function () {
      for (const node of ["kitchen-pi", "conf", "a.b"])
        expect(
          realConfigs.nodeNameFromPath(realConfigs.configFileNameForNode(node)),
          node,
        ).to.equal(node);
    });

    it("publishes a downloaded fleet back to the topics it came from", async function () {
      await download({ connectionName: "test" } as DownloadArgs);

      const downloaded = mockWriteFile.mock.calls.map(
        (call) => call.arguments[0] as string,
      );
      expect(downloaded).to.deep.equal(["bob.conf.json", "chicken.conf.json"]);

      // Feed exactly those filenames back through the upload walk.
      mockReaddir.mock.mockImplementationOnce(async () =>
        downloaded.map((name) => fakeDirEnt(".", name)),
      );
      mockUploadSingleConfig.mock.resetCalls();

      await upload({ connectionName: "test", path: "." } as UploadArgs);

      const uploaded = mockUploadSingleConfig.mock.calls.map(
        (call) => call.arguments[0],
      );
      expect(uploaded.sort()).to.deep.equal(["bob", "chicken"]);
    });
  });

  describe("init command", function () {
    let originalCwd: string,
      tempDir: string,
      initializeConfig: () => Promise<void>;

    before(async () => {
      originalCwd = process.cwd();
      tempDir = await mkdtemp(join(tmpdir(), "cutie-init-"));
      initializeConfig = (await import("../../src/cli/init.js")).default;
      process.chdir(tempDir);
    });

    after(async () => {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
      process.exitCode = 0;
    });

    it("writes a config file cutie can load", async function () {
      await initializeConfig();

      // cutie.conf.yaml has comments -- node-yaml's reader is what actually
      // loads it at runtime, so assert against that instead of JSON.parse.
      const parsed = await read(join(tempDir, "cutie.conf.yaml"));
      expect(parsed.connections).to.be.an("array");
      expect(process.exitCode).to.not.equal(1);
    });

    it("refuses to overwrite an existing config file", async function () {
      const before = await readFile(join(tempDir, "cutie.conf.yaml"), {
        encoding: "utf8",
      });

      await initializeConfig();

      const after = await readFile(join(tempDir, "cutie.conf.yaml"), {
        encoding: "utf8",
      });
      expect(after).to.equal(before);
      expect(process.exitCode).to.equal(1);
    });
  });
});
