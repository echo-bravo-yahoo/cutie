import { describe, it, before } from "node:test";

import { expect } from "chai";

import MQTT, { MQTTConfig } from "../../src/outputs/mqtt.js";
import { setGlobals } from "../../src/index.js";
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
});
