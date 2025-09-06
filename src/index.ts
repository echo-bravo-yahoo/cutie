import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const srcDir = __dirname;

import { read } from "node-yaml";

import { registerConnections } from "./util/connections.js";
import { registerTasks } from "./util/tasks.js";
import { CLIArgs } from "./cli-entrypoint.js";
import Task from "./util/Task.js";
import { Connection } from "./util/Connection.js";
import LogHelper from "./util/LogHelper.js";
import { fetchRemoteConfig } from "./util/configs.js";
import { EventEmitter } from "node:events";

export interface Globals {
  tasks: Array<Task>;
  connections: Array<Connection>;
  version: string;
  logger: LogHelper;
  eventBus: EventEmitter;
}

// by the time consumers see this object, it's been properly instantiated
export let globals: Globals = {} as unknown as Globals;

// used for testing
export function setGlobals(newValue: Globals) {
  globals = newValue;
}

export async function start(args: CLIArgs) {
  const configPromise = read(normalize(args.config));
  const packageJsonPromise = read(normalize(`${__dirname}/../package.json`));

  await Promise.all([configPromise, packageJsonPromise]);
  const packageJson = await packageJsonPromise;

  globals = {
    tasks: [],
    connections: [],
    version: packageJson.version,
    logger: new LogHelper(),
    eventBus: new EventEmitter(),
  };

  let config = await configPromise;
  // TODO: write backup of config to file for later
  if (config.configProvider) config = await fetchRemoteConfig(config);

  await registerConnections(config.connections);
  await registerTasks(config.tasks);
}
