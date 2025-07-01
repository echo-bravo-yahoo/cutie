import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const srcDir = __dirname;

import { read } from "node-yaml";

import loggerFactory, { Logger, LoggerOptions } from "pino";
import { registerConnections } from "./util/connections.js";
import { registerTasks } from "./util/tasks.js";
import { CLIArgs } from "./cli-entrypoint.js";

export let globals = {};

// used for testing
export function setGlobals(newValue: any) {
  globals = newValue;
}

export async function start(args: CLIArgs) {
  const configPromise = read(normalize(args.config));
  const packageJsonPromise = read(normalize(`${__dirname}/../package.json`));

  await Promise.all([configPromise, packageJsonPromise]);
  const config = await configPromise;
  const packageJson = await packageJsonPromise;

  globals = {
    tasks: [],
    connections: [],
    version: packageJson.version,
    logger: (
      loggerFactory as unknown as (options?: LoggerOptions<any>) => Logger
    )({
      level: config.logLevel || "debug",
      messageKey: "log",
      errorKey: "error",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    }),
  };

  await registerConnections(config.connections);
  await registerTasks(config.tasks);
}
