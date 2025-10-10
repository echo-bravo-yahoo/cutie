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
import { fetchConfig } from "./util/configs.js";
import { EventEmitter } from "node:events";
import { setupProcess } from "./process.js";

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

export function initializeGlobals() {
  const packageJson = read(normalize(`${__dirname}/../package.json`));

  globals = {
    tasks: [],
    connections: [],
    version: packageJson.version,
    logger: new LogHelper(),
    eventBus: new EventEmitter(),
  };
}

export async function start(args: CLIArgs) {
  setupProcess(process);

  const config = await fetchConfig(args.config);

  initializeGlobals();

  await registerConnections(config.connections);
  await registerTasks(config.tasks);

  return globals;
}
