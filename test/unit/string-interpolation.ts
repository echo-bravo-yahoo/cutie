import { describe, it, before } from "node:test";

import { expect } from "chai";

import MQTT, { MQTTConfig } from "../../src/outputs/mqtt.js";
import { setGlobals } from "../../src/index.js";
import Task from "../../src/util/Task.js";
import { mockGlobals, mockTask } from "../helpers.js";

describe("string interpolation", function () {
  before(() => {
    setGlobals(mockGlobals);
  });

  it("works for nested module data", async function () {
    const module = new MQTT(
      {
        device: { location: { shortName: "livingRoom" } },
      } as unknown as MQTTConfig,
      mockTask,
    );

    const interpolated = module.interpolateConfigString(
      "devices/${module.device.location.shortName}",
    );
    expect(interpolated).to.deep.equal("devices/livingRoom");
  });

  it("works for nested global data", async function () {
    const module = new MQTT({} as MQTTConfig, mockTask);

    const interpolated = module.interpolateConfigString(
      "devices/${globals.deeply.nested}",
    );
    expect(interpolated).to.deep.equal("devices/metadata");
  });

  describe("a template that fills the whole string", function () {
    function module() {
      return new MQTT({} as MQTTConfig, mockTask);
    }

    const message = { count: 5, device: { id: "abc", tags: ["a"] } };

    it("yields the value with its type", function () {
      expect(
        module().interpolateDeep("${message.count}", { message }),
      ).to.equal(5);
    });

    it("yields an object rather than its stringification", function () {
      expect(
        module().interpolateDeep("${message.device}", { message }),
      ).to.deep.equal({ id: "abc", tags: ["a"] });
    });

    it("splices when there is text around it", function () {
      expect(
        module().interpolateDeep("count is ${message.count}", { message }),
      ).to.equal("count is 5");
    });

    it("splices when the string holds two of them", function () {
      expect(
        module().interpolateDeep("${message.count}/${message.device.id}", {
          message,
        }),
      ).to.equal("5/abc");
    });

    it("leaves a path that resolves to nothing as it was", function () {
      expect(
        module().interpolateDeep("${message.missing}", { message }),
      ).to.equal("undefined");
    });

    it("still interpolates every string inside an object", function () {
      expect(
        module().interpolateDeep(
          { a: "${message.count}", b: "x" },
          { message },
        ),
      ).to.deep.equal({ a: 5, b: "x" });
    });

    // interpolateConfigString is what topics, file paths, stash keys, and shell
    // commands go through, and every one of those needs a string.
    it("does not change what interpolateConfigString returns", function () {
      expect(
        module().interpolateConfigString("${message.count}", { message }),
      ).to.equal("5");
    });
  });

  describe("output:stash", function () {
    // mockGlobals has no logger, and a step logs as it runs.
    before(() => {
      const fakeLogger = { emit: () => {}, logListeners: [] };
      setGlobals({ ...mockGlobals, logger: fakeLogger } as never);
    });

    it("stashes the value's own type, not its stringification", async function () {
      const task = new Task(
        {
          steps: [
            {
              type: "output:stash",
              key: "count",
              value: "${message.count}",
            } as never,
            { type: "read:stash", key: "count" } as never,
          ],
        },
        "stashes a number",
      );
      await task.register();

      expect(await task.startMessage({ count: 5 })).to.equal(5);
    });
  });
});
