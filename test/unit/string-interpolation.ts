import { expect } from "chai";

import MQTT, { MQTTConfig } from "../../src/outputs/mqtt.js";
import { setGlobals } from "../../src/index.js";
import Task from "../../src/util/generic-task.js";

describe("string interpolation", function () {
  before(() => {
    setGlobals({ name: "island", deeply: { nested: "metadata" } });
  });

  it("works for nested module data", async function () {
    const module = new MQTT(
      {
        device: { location: { shortName: "livingRoom" } },
      } as unknown as MQTTConfig,
      {} as Task
    );

    const interpolated = module.interpolateConfigString(
      "devices/${module.device.location.shortName}"
    );
    expect(interpolated).to.deep.equal("devices/livingRoom");
  });

  it("works for nested global data", async function () {
    const module = new MQTT({} as MQTTConfig, {} as Task);

    const interpolated = module.interpolateConfigString(
      "devices/${globals.deeply.nested}"
    );
    expect(interpolated).to.deep.equal("devices/metadata");
  });
});
