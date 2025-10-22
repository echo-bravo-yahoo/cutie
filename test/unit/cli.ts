import { describe, it, before, afterEach, Mock, mock } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { setGlobals } from "../../src/index.js";
import type { fetchConfig } from "../../src/util/configs.js";
import type { writeFile } from "fs";
import { Connection } from "../../src/util/Connection.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import { DownloadArgs } from "../../src/cli/download.js";

describe("the CLI's", function () {
  const fakeLogger = {
    emit: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  before(() => {
    setGlobals({ logger: fakeLogger });
  });

  describe("download command", async function () {
    const remoteConfig = { connections: [], tasks: [] };
    const remoteConfig2 = {
      connections: [{ type: "connection:mqtt", name: "test" }],
      tasks: [],
    };

    let mockFetchConfig: Mock<typeof fetchConfig>,
      mockWriteFile: Mock<typeof writeFile>,
      mockFetchSingleConfig: Mock<Connection["fetchSingleConfig"]>,
      mockFetchAllConfigs: Mock<Connection["fetchAllConfigs"]>,
      download: (args: DownloadArgs) => Promise<any>;

    before(async () => {
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
      mockWriteFile = mock.fn(async function () {});
      mockFetchSingleConfig = mock.fn(async () => remoteConfig);
      mockFetchAllConfigs = mock.fn(async () => ({
        bob: remoteConfig,
        chicken: remoteConfig2,
      }));
      mock.module("../../src/util/configs.js", {
        namedExports: { fetchConfig: mockFetchConfig },
      });
      mock.module("node:fs/promises", {
        namedExports: {
          writeFile: mockWriteFile,
        },
      });
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
      download = (await import("../../src/cli/download.js")).default;
    });

    afterEach(() => {
      mockFetchConfig.mock.resetCalls();
      mockWriteFile.mock.resetCalls();
      mockFetchSingleConfig.mock.resetCalls();
      mockFetchAllConfigs.mock.resetCalls();
    });

    it('can download one file from the default MQTT location, "cutie/config/$node" to the default path "."', async function () {
      await download({
        connectionName: "test",
        config: "./cutie.conf.json",
        node: "bob",
      });
      expect(mockWriteFile.mock.calls[0].arguments).to.deep.equal([
        "bob.conf.json",
        JSON.stringify(remoteConfig, null, 4),
      ]);
      expect(mockFetchSingleConfig.mock.calls[0].arguments).to.deep.equal([
        "bob",
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

    it.skip('can download one file from a non-default MQTT location to the default path "."', async function () {
      await download({
        connectionName: "test",
        // new param???
        node: "bob",
      });
      throw new Error("not implemented");
    });

    it.skip("can download one file from a non-default MQTT location to a non-default path", async function () {
      await download({
        connectionName: "test",
        // new param???
        node: "bob",
        path: "./somewhere/else",
      });
      throw new Error("not implemented");
    });

    it.skip('can download multiple files from a non-default MQTT location to the default path "."', async function () {
      await download({
        connectionName: "test",
        // new param???
      });
      throw new Error("not implemented");
    });

    it.skip("can download multiple files from a non-default MQTT location to a non-default path", async function () {
      await download({
        connectionName: "test",
        // new param???
        path: "./somewhere/else",
      });
      throw new Error("not implemented");
    });
  });

  describe.skip("upload command", function () {});
});
