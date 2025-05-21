import { expect } from "chai";

import MQTT from "../../src/modules/mqtt.js";
import { setGlobals } from "../../src/index.js";

describe("string interpolation", function () {
  before(() => {
    setGlobals({ name: "island", deeply: { nested: "metadata" } });
  });

  it("works for nested module data", async function () {
    const module = new MQTT({
      device: { location: { shortName: "livingRoom" } },
    });

    const interpolated = module.interpolateConfigString(
      "devices/${module.device.location.shortName}"
    );
    expect(interpolated).to.deep.equal("devices/livingRoom");
  });

  it("works for nested global data", async function () {
    const module = new MQTT({});

    const interpolated = module.interpolateConfigString(
      "devices/${globals.deeply.nested}"
    );
    expect(interpolated).to.deep.equal("devices/metadata");
  });
});
