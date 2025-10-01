import { describe, it, MockFunctionContext, mock } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { start, srcDir } from "../../src/index.js";
import { watch } from "fs";
import { normalize } from "path";

describe("examples run correctly, including", function () {
  it("clock.yaml", async function (context) {
    console.log = context.mock.fn(console.log, () => {});
    const mockLogs = (console.log as it.Mock<typeof console.log>)
      .mock as MockFunctionContext<typeof console.log>;
    context.mock.timers.enable({ apis: ["setInterval"] });

    await start({
      _: [],
      config: `./examples/clock.yaml`,
    });

    context.mock.timers.tick(5000);

    expect(mockLogs.callCount()).to.equal(5);
    expect(
      mockLogs.calls.every(
        (call) =>
          call.arguments.length === 1 && call.arguments[0] === "Tick...",
      ),
    );
  });

  it("interpolation.yaml", async function (context) {
    let fileChangedCallback: Parameters<typeof watch>[1];
    const mockWatch = context.mock.fn(
      (_path, _options, callback) => (fileChangedCallback = callback),
    );
    const mockWriteFile = context.mock.fn((_path, _message, _options) => {});
    const mockAppendFile = context.mock.fn((_path, _message, _options) => {});
    const mockReadFile = context.mock.fn((_path: string) =>
      Promise.resolve(""),
    );

    mockReadFile.mock.mockImplementation((path: string) => {
      if (path.endsWith("/imaginary/path")) {
        return Promise.resolve("first");
      } else {
        return Promise.resolve("second");
      }
    });

    mock.module("node:fs", {
      namedExports: {
        watch: mockWatch,
      },
    });

    mock.module("node:fs/promises", {
      namedExports: {
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        appendFile: mockAppendFile,
      },
    });

    await start({
      _: [],
      config: `./examples/interpolation.yaml`,
    });

    fileChangedCallback!("change", "./some/imaginary/path");
    await new Promise((resolve) => setTimeout(resolve, 0));
    fileChangedCallback!("change", "./some/imaginary/second/path");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWriteFile.mock.callCount()).to.equal(2);
    expect(mockWriteFile.mock.calls).to.satisfy(
      (calls) =>
        calls.find(
          (call) =>
            call.arguments[0] ===
              normalize(`${srcDir}/../config/some/imaginary/path`) &&
            call.arguments[1] === "first" &&
            call.arguments[2].encoding === "utf8",
        ) !== undefined,
    );
    expect(mockWriteFile.mock.calls).to.satisfy(
      (calls) =>
        calls.find(
          (call) =>
            call.arguments[0] ===
              normalize(`${srcDir}/../config/some/imaginary/second/path`) &&
            call.arguments[1] === "second" &&
            call.arguments[2].encoding === "utf8",
        ) !== undefined,
    );
  });

  // need to mock bme280
  it.skip("basic-sensors.yaml", async function (_context) {});

  // need to mock mqtt broker
  it.skip("remote-clock.yaml", async function (_context) {});

  // need to mock mqtt broker
  it.skip("remote-config.yaml", async function (_context) {});
});
