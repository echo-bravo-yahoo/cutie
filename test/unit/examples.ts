import { before, describe, it, MockFunctionContext, mock } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { start, srcDir, globals } from "../../src/index.js";
import { watch } from "fs";
import { rm } from "fs/promises";
import { normalize } from "path";
import { createMqttMock } from "../helpers.js";

describe("examples run correctly, including", function () {
  // "mqtt" can only be mocked once per process, so every test that needs a
  // broker shares this one and populates its retained messages as needed.
  const broker = createMqttMock();

  before(() => {
    mock.module("mqtt", { defaultExport: broker.mqtt });
  });

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
    ).to.equal(true);
  });

  it("interpolation.yaml", async function (context) {
    let fileChangedCallback: Parameters<typeof watch>[1];
    console.log = context.mock.fn(console.log, () => {});
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
      (calls: Array<any>) =>
        calls.find(
          (call: any) =>
            call.arguments[0] ===
              normalize(`${srcDir}/../config/some/imaginary/path`) &&
            call.arguments[1] === "first" &&
            call.arguments[2].encoding === "utf8",
        ) !== undefined,
    );
    expect(mockWriteFile.mock.calls).to.satisfy(
      (calls: Array<any>) =>
        calls.find(
          (call: any) =>
            call.arguments[0] ===
              normalize(`${srcDir}/../config/some/imaginary/second/path`) &&
            call.arguments[1] === "second" &&
            call.arguments[2].encoding === "utf8",
        ) !== undefined,
    );
  });

  // the example declares the bme280 as virtual, so it needs no hardware and
  // no sensor mock
  it("basic-sensors.yaml", async function (context) {
    console.log = context.mock.fn(console.log, () => {});
    const mockLogs = (console.log as it.Mock<typeof console.log>)
      .mock as MockFunctionContext<typeof console.log>;
    context.mock.timers.enable({ apis: ["setInterval"] });

    await start({
      _: [],
      config: `./examples/basic-sensors.yaml`,
    });

    // one reading per second, batched five at a time by transform:accumulate
    context.mock.timers.tick(5000);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockLogs.callCount()).to.equal(1);
    const batch = JSON.parse(mockLogs.calls[0].arguments[0] as string);
    expect(batch).to.have.lengthOf(5);
    for (const reading of batch) {
      expect(reading).to.have.property("temp");
      expect(reading).to.have.property("humidity");
      expect(reading).to.have.property("pressure");
    }
  });

  it("remote-clock.yaml", async function (context) {
    console.log = context.mock.fn(console.log, () => {});
    const mockLogs = (console.log as it.Mock<typeof console.log>)
      .mock as MockFunctionContext<typeof console.log>;

    context.mock.timers.enable({ apis: ["setInterval"] });

    await start({
      _: [],
      config: `./examples/remote-clock.yaml`,
    });

    // the local-clock task publishes to a topic the network-clock task is
    // subscribed to, so each tick makes a full round trip through the broker
    context.mock.timers.tick(3000);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockLogs.callCount()).to.equal(3);
    expect(
      mockLogs.calls.every(
        (call) =>
          call.arguments.length === 1 && call.arguments[0] === "Remote tick...",
      ),
    ).to.equal(true);
  });

  it("cutie.conf.yaml (the default config `cutie init` copies)", async function (context) {
    console.log = context.mock.fn(console.log, () => {});
    const mockLogs = (console.log as it.Mock<typeof console.log>)
      .mock as MockFunctionContext<typeof console.log>;

    context.mock.timers.enable({ apis: ["setInterval"] });

    const observer = await broker.mqtt.connectAsync();
    const received: Array<{ topic: string; payload: string }> = [];
    observer.on("message", (topic: string, payload: Buffer) =>
      received.push({ topic, payload: payload.toString() }),
    );
    await observer.subscribeAsync(["cutie/heartbeat", "cutie/logs"]);

    await start({
      _: [],
      config: `./config/cutie.conf.yaml`,
    });

    // trigger:logs only starts listening once its own task finishes
    // registering, so nothing from startup itself reaches it -- emit one
    // deliberately to exercise both output steps.
    globals.logger.emit("test log line", "info", "some.topic", {});

    context.mock.timers.tick(60000);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      received.some(
        (m) => m.topic === "cutie/heartbeat" && m.payload === '"online"',
      ),
    ).to.equal(true);
    expect(
      received.some(
        (m) => m.topic === "cutie/logs" && m.payload.includes("test log line"),
      ),
    ).to.equal(true);
    expect(
      mockLogs.calls.some((call) =>
        String(call.arguments[0]).includes("test log line"),
      ),
    ).to.equal(true);
  });

  it("remote-config.yaml", async function (context) {
    console.log = context.mock.fn(console.log, () => {});
    const mockLogs = (console.log as it.Mock<typeof console.log>)
      .mock as MockFunctionContext<typeof console.log>;

    // the config the node fetches instead of using its own
    const servedConfig = {
      connections: [],
      tasks: {
        greet: {
          trigger: { type: "trigger:once", message: "remote hello" },
          steps: [{ type: "output:console" }],
        },
      },
    };

    broker.retainedMessages.set(
      "cutie/config/remote-config-demo-node",
      JSON.stringify(servedConfig),
    );

    try {
      await start({
        _: [],
        config: `./examples/remote-config.yaml`,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(
        mockLogs.calls.some((call) => call.arguments[0] === "remote hello"),
      ).to.equal(true);
    } finally {
      // the fetched config is cached next to the local one; it is a copy of a
      // real config and may carry credentials, so never leave it behind
      await rm(`./examples/remote-config.yaml.cache.json`, { force: true });
    }
  });
});
