import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import mqtt from "mqtt";
import { read } from "node-yaml";

import bme280 from "./modules/bme280.js";
import bme680 from "./modules/bme680.js";
import bleTracker from "./modules/ble-tracker.js";

import loggerFactory from "pino";

export let globals;

export async function start(args) {
  const configPromise = read(args.config);
  const statePromise = read(args.state);
  const packageJsonPromise = read(`${__dirname}/../package.json`);

  await Promise.all([configPromise, statePromise, packageJsonPromise]);
  const config = await configPromise;
  const state = await statePromise;
  const packageJson = await packageJsonPromise;

  globals = {
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
}
