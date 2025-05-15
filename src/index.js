import mqtt from "mqtt";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config/config.json");
const state = require("../config/state.json");
const packageJson = require("../package.json");

import bme280 from "./modules/bme280.js";
import bme680 from "./modules/bme680.js";
import bleTracker from "./modules/ble-tracker.js";

import loggerFactory from "pino";

export const globals = {
  modules: [bme280, bme680, bleTracker],
  configs: [],
  name: config.name,
  version: packageJson.version,
  logger: loggerFactory({ level: "debug" }),
  connection: mqtt.connect(config.mqttOptions.endpoint, {
    ...config.mqttOptions,
    endpoint: undefined,
  }),
  state,
};

globals.logger.info({ role: "breadcrumb" }, "Registering modules...");
const promises = [];
globals.modules.forEach((module) => {
  if (module.register) promises.push(module.register());
});
await Promise.all(promises);
globals.logger.info({ role: "breadcrumb" }, "Registration completed.");
