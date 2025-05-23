import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import { read } from "node-yaml";

import loggerFactory from "pino";
import { registerModules } from "./util/modules.js";
import { registerConnections } from "./util/connections.js";

export let globals = {};

// used for testing
export function setGlobals(newValue) {
  globals = newValue;
}

export async function start(args) {
  const configPromise = read(normalize(args.config));
  const packageJsonPromise = read(normalize(`${__dirname}/../package.json`));

  await Promise.all([configPromise, packageJsonPromise]);
  const config = await configPromise;
  const packageJson = await packageJsonPromise;

  globals = {
    modules: [],
    connections: [],
    name: config.name,
    version: packageJson.version,
    logger: loggerFactory({ level: config.logLevel || "debug" }),
  };

  await registerConnections(config.connections);
  await registerModules(config.modules);

  console.log("globals", {
    ...globals,
    logger: undefined,
  });
}
