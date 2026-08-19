import { FSWatcher, watch } from "node:fs";

import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";
import { resolveConfigPath } from "../util/Step.js";
import { ModuleSchema } from "../util/schema.js";

export interface FileChangeConfig extends TriggerConfig {
  path: string;
  recursive: boolean;
}

export default class FileChange extends Trigger {
  declare config: FileChangeConfig;
  declare watcher?: FSWatcher;

  constructor(config: FileChangeConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async enable() {
    this.watcher = watch(
      resolveConfigPath(this.config.path),
      { recursive: this.config.recursive },
      (eventType, filename) => {
        this.startMessage({ eventType, filename });
      },
    );
    this.info(
      `Started watching filesystem changes${this.config.recursive ? " recursively" : ""} on path ${this.config.path}.`,
    );
    this.enabled = true;
  }

  async disable() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.info(
      `Stopped watching filesystem changes${this.config.recursive ? " recursively" : ""} on path ${this.config.path}.`,
    );
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "trigger:file-change",
  description:
    "Starts a message of {eventType, filename} whenever a watched file or directory changes.",
  options: {
    path: {
      type: "string",
      description:
        "The file or directory to watch, resolved against the config file's directory unless absolute.",
      required: true,
    },
    recursive: {
      type: "boolean",
      description:
        "Watch a directory's whole subtree rather than just its entries.",
      default: false,
    },
  },
};
