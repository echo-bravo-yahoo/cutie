import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import { read } from "node-yaml";

import loggerFactory from "pino";
import { registerModules } from "./util/modules.js";
import { registerDestinations } from "./util/destinations.js";

export let globals;

export async function start(args) {
  const configPromise = read(normalize(args.config));
  const statePromise = read(normalize(args.state));
  const packageJsonPromise = read(normalize(`${__dirname}/../package.json`));

  await Promise.all([configPromise, statePromise, packageJsonPromise]);
  const config = await configPromise;
  const state = await statePromise;
  const packageJson = await packageJsonPromise;

  globals = {
    modules: [],
    destinations: [],
    name: state.name,
    version: packageJson.version,
    logger: loggerFactory({ level: config.logLevel || "debug" }),
  };

  await registerModules(state.modules);
  await registerDestinations(state.destinations);

  console.log("globals", {
    ...globals,
    logger: undefined,
    connection: undefined,
  });
}
