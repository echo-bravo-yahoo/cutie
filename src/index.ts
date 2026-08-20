import { dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const srcDir = __dirname;

import { readSync } from "node-yaml";
import parser from "yargs-parser";

import { registerConnections } from "./util/connections.js";
import { registerTasks } from "./util/tasks.js";
import LogHelper from "./util/LogHelper.js";
import { ConfigFile, fetchConfig } from "./util/configs.js";
import { teardown } from "./util/lifecycle.js";
import { watchConfig } from "./util/watch-config.js";
import { EventEmitter } from "node:events";
import { setupProcess } from "./process.js";
import { CLIArgs, parserDefaults } from "./util/cli.js";
import { globals, setGlobals } from "./util/globals.js";
import { reportConfigErrors, validateConfig } from "./util/validate.js";
import type { Verbosity } from "./triggers/logs.js";

// `globals` lives in its own leaf module so that the Configurable hierarchy can
// reach it without importing this one, which pulls in the whole runtime and so
// would re-enter the hierarchy before its base classes are defined.
export { globals, setGlobals } from "./util/globals.js";
export type { Globals } from "./util/globals.js";

export function initializeGlobals(logLevel?: Verbosity, configPath?: string) {
  const packageJson = readSync(normalize(`${__dirname}/../package.json`));

  setGlobals({
    tasks: [],
    connections: [],
    version: packageJson.version,
    logger: new LogHelper(logLevel),
    eventBus: new EventEmitter(),
    configDir: configPath
      ? // absolute, so a relative --config still names one fixed directory
        dirname(resolve(configPath))
      : process.cwd(),
  });
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
  // keepProvider, unlike every other caller: the connection the config came
  // over is what watchConfig below goes on listening to.
  const config = await fetchConfig(args.config, { keepProvider: true });

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

  // Registration is over, so every trigger:logs task the config declares is
  // listening and there is no window left to hold lines for.
  globals.logger.stopBuffering();

  await watchConfig(configPath, config);

  return globals;
}

// A running node rebuilt from a new config: the same three calls start() makes,
// with the fetch already done and a teardown in front of them.
export async function reload(config: ConfigFile, configPath: string) {
  // Refused before anything is torn down, so a bad config costs nothing.
  if (reportConfigErrors(await validateConfig(config, { configPath }))) {
    globals.logger.error(
      `Refusing to reload: the new config at "${configPath}" is not valid. Still running the previous one.`,
    );
    return false;
  }

  globals.logger.info(`Config at "${configPath}" changed; reloading.`);
  // Re-opened for the length of the reload so the lines it writes reach the
  // trigger:logs tasks the new config declares, exactly as they reach the ones
  // the first config declared. Safe because the window closes again below.
  globals.logger.startBuffering();

  await teardown();
  globals.tasks = [];
  globals.connections = [];

  try {
    await registerConnections(config.connections ?? []);
    await registerTasks(config.tasks ?? []);
  } catch (error) {
    // Validation passed, so this is registerTasks refusing a config whose every
    // task failed. The old config is already gone, so there is nothing to fall
    // back to in process; the supervisor restarting is the recovery.
    await globals.logger.fatal(
      `Reloaded config at "${configPath}" registered nothing. Terminating so the supervisor can restart.`,
      { err: error },
    );
    process.exit(1);
  }

  globals.logger.stopBuffering();
  globals.logger.info(`Reloaded config at "${configPath}".`);
  return true;
}
