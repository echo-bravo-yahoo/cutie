import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import { read } from "node-yaml";

import loggerFactory from "pino";
import { registerModules } from "./util/modules.js";
import { registerExchanges } from "./util/exchanges.js";

export let globals;

export async function start(args) {
  const configPromise = read(normalize(args.config));
  const packageJsonPromise = read(normalize(`${__dirname}/../package.json`));

  await Promise.all([configPromise, packageJsonPromise]);
  const config = await configPromise;
  const packageJson = await packageJsonPromise;

  globals = {
    modules: [],
    exchanges: [],
    name: config.name,
    version: packageJson.version,
    logger: loggerFactory({ level: config.logLevel || "debug" }),
  };

  await registerModules(config.modules);
  await registerExchanges(config.exchanges);

  console.log("globals", {
    ...globals,
    logger: undefined,
  });
}
