import type { EventEmitter } from "node:events";

import type { Connection } from "./Connection.js";
import type LogHelper from "./LogHelper.js";
import type Task from "./Task.js";

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
