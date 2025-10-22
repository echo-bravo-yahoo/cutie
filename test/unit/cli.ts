import { describe, before, afterEach, test, Mock, mock } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { setGlobals, srcDir } from "../../src/index.js";
import type { fetchConfig } from "../../src/util/configs.js";
import type { writeFile } from "fs";
import { Connection } from "../../src/util/Connection.js";
import MQTTConnection from "../../src/connections/mqtt.js";

describe("transforms", function () {
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

  const downloadTestCases = [
    {
      title:
        'can download one file from the default MQTT location, "cutie/config/$node" to the default path "."',
      args: {
        connectionName: "test",
        config: "./cutie.conf.json",
        node: "bob",
      },
      validator: function (
        mockFetchConfig: Mock<typeof fetchConfig>,
        mockWriteFile: Mock<typeof writeFile>,
        mockFetchSingleConfig: Mock<Connection["fetchSingleConfig"]>,
      ) {
        expect(mockFetchConfig.mock.calls[0]).to.equal(["lol"]);
        expect(mockWriteFile.mock.calls[0]).to.equal([]);
        expect(mockFetchSingleConfig.mock.calls[0]).to.equal([]);
      },
    },
    {
      title:
        'can download one file from the default MQTT location, "cutie/config/$node" to a non-default',
      args: {
        connectionName: "test",
        node: "bob",
        path: "./somewhere/else",
      },
      validator: function (mockFetchConfig, mockFS, mockMQTTConnection) {},
    },
    // {
    //   title:
    //     'can download one file from a non-default MQTT location to the default path "."',
    //   args: {
    //     connectionName: "test",
    //     node: "bob",
    //     path: "./somewhere/else",
    //   },
    // validator: function (mockFetchConfig, mockFS, mockMQTTConnection) {},
    // },
    // {
    //   title:
    //     "can download one file from a non-default MQTT location to a non-default path",
    // },
    {
      title:
        'can download multiple files from the default MQTT location, "cutie/config/$node" to the default path "."',
      args: {
        connectionName: "test",
      },
      validator: function (mockFetchConfig, mockFS, mockMQTTConnection) {},
    },
    {
      title:
        'can download multiple files from the default MQTT location, "cutie/config/$node" to a non-default path',
      args: {
        connectionName: "test",
        path: "./somewhere/else",
      },
      validator: function (mockFetchConfig, mockFS, mockMQTTConnection) {},
    },
    // {
    //   title:
    //     'can download multiple files from a non-default MQTT location to the default path "."',
    // validator: function (mockFetchConfig, mockFS, mockMQTTConnection) {},
    // },
    // {
    //   title:
    //     "can download multiple files from a non-default MQTT location to a non-default path",
    // validator: function (mockFetchConfig, mockFS, mockMQTTConnection) {},
    // },
  ];

  describe("the cli's", function () {
    afterEach(() => {
      mock.restoreAll();
    });
    before(() => {});

    test("download command", { concurrency: true }, (testContext) => {
      for (const { title, args, validator } of downloadTestCases) {
        testContext.test(title, async () => {
          // throw new Error(`srcDir: ${srcDir}`);
          const mockFetchConfig = testContext.mock.fn(async function () {
            return {
              connections: [
                {
                  type: "connection:mqtt",
                  name: "test",
                },
              ],
            };
          });
          const mockWriteFile = testContext.mock.fn(async function () {});
          const mockFetchSingleConfig = testContext.mock.fn(
            async function () {},
          );
          testContext.mock.module("../../src/util/configs.js", {
            namedExports: { fetchConfig: mockFetchConfig },
          });
          testContext.mock.module("node:fs/promises", {
            namedExports: {
              writeFile: mockWriteFile,
            },
          });
          testContext.mock.method(
            MQTTConnection.prototype,
            "fetchSingleConfig",
            mockFetchSingleConfig,
          );
          const download = (await import("../../src/cli/download.js")).default;
          await download(args);
          validator(mockFetchConfig, mockWriteFile, mockFetchSingleConfig);
          console.log("validated");
        });
      }
    });

    describe.skip("upload command", function () {});
  });
});
