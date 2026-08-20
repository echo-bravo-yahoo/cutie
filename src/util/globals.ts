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

// Registered and enabled, not merely declared: the validator rejects a rescue
// or a branch naming a task the config does not have, so what is left is a
// task that failed to register, and a half-registered chain is not one to hand
// a message to.
export function findRegisteredTask(name: string): Task | undefined {
  return globals.tasks.find((task) => task.name === name && task.enabled);
}
