import { describe, before, test } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { setGlobals } from "../../src/index.js";

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
        node: "bob",
        path: "./somewhere/else",
      },
    },
    {
      title:
        'can download one file from the default MQTT location, "cutie/config/$node" to a non-default',
    },
    {
      title:
        'can download one file from a non-default MQTT location to the default path "."',
    },
    {
      title:
        "can download one file from a non-default MQTT location to a non-default path",
    },
    {
      title:
        'can download multiple files from the default MQTT location, "cutie/config/$node" to the default path "."',
    },
    {
      title:
        'can download multiple files from the default MQTT location, "cutie/config/$node" to a non-default path',
    },
    {
      title:
        'can download multiple files from a non-default MQTT location to the default path "."',
    },
    {
      title:
        "can download multiple files from a non-default MQTT location to a non-default path",
    },
  ];

  describe("the cli's", function () {
    describe("download command", function () {
      test.skip("download command", { concurrency: true }, (testContext) => {
        for (const { title, _args } of downloadTestCases) {
          testContext.test(title, () => {});
        }
      });
    });

    describe.skip("upload command", function () {});
  });
});
