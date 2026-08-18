import { dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const srcDir = __dirname;

import { readSync } from "node-yaml";
import parser from "yargs-parser";

import { registerConnections } from "./util/connections.js";
import { registerTasks } from "./util/tasks.js";
import Task from "./util/Task.js";
import { Connection } from "./util/Connection.js";
import LogHelper from "./util/LogHelper.js";
import { fetchConfig } from "./util/configs.js";
import { EventEmitter } from "node:events";
import { setupProcess } from "./process.js";
import { CLIArgs, parserDefaults } from "./util/cli.js";
import { reportConfigErrors, validateConfig } from "./util/validate.js";
import type { Verbosity } from "./triggers/logs.js";

export interface Globals {
  tasks: Array<Task>;
  connections: Array<Connection>;
  version: string;
  logger: LogHelper;
  eventBus: EventEmitter;
  // Directory of the config file in use. Every relative path a config supplies
  // resolves against this, not against the process's working directory.
  configDir: string;
}

// by the time consumers see this object, it's been properly instantiated
export let globals: Globals = {} as unknown as Globals;

// used for testing
export function setGlobals(newValue: Globals) {
  globals = newValue;
}

export function initializeGlobals(logLevel?: Verbosity, configPath?: string) {
  const packageJson = readSync(normalize(`${__dirname}/../package.json`));

  globals = {
    tasks: [],
    connections: [],
    version: packageJson.version,
    logger: new LogHelper(logLevel),
    eventBus: new EventEmitter(),
    configDir: configPath
      ? // absolute, so a relative --config still names one fixed directory
        dirname(resolve(configPath))
      : process.cwd(),
  };
}

export async function start(maybeArgs?: CLIArgs) {
  setupProcess(process);

  const args = maybeArgs
    ? maybeArgs
    : (parser(
        process.argv.slice(2) || "",
        parserDefaults,
      ) as unknown as CLIArgs);

  initializeGlobals(args.logLevel, args.config);

  const configPath = normalize(args.config);
  const config = await fetchConfig(args.config);

  // Nothing opens a socket or drives a pin until the config is known good, so
  // a wrong config produces one clear report instead of a downstream crash.
  if (reportConfigErrors(await validateConfig(config, { configPath })))
    throw new Error(
      `Refusing to start: the config at "${configPath}" is not valid.`,
    );

  // tasks start immediately and may need connections to exist
  // so we have to register connections first
  await registerConnections(config.connections ?? []);
  await registerTasks(config.tasks ?? []);

  return globals;
}
