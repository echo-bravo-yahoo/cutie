import { FSWatcher, watch } from "node:fs";

import Trigger, { TriggerConfig } from "../util/Trigger.js";
import Task from "../util/Task.js";

export interface FileChangeConfig extends TriggerConfig {
  path: string;
  recursive: boolean;
}

export default class FileChange extends Trigger {
  declare config: FileChangeConfig;
  declare watcher?: FSWatcher;

  constructor(config: FileChangeConfig, task: Task) {
    super(config, task);
  }

  errorHandler() {}

  async enable() {
    this.watcher = watch(
      this.config.path,
      { recursive: this.config.recursive },
      (eventType, filename) => {
        this.startMessage({ eventType, filename });
      },
    );
    this.info(
      `Started watching filesystem changes${this.config.recursive ? " recursively" : ""} on path ${this.config.path}.`,
      { topic: this.logPrefix },
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
      { topic: this.logPrefix },
    );
    this.enabled = false;
  }
}

/*
{
  "type": "trigger:file-change",
  "disabled": false,
  "path": "./some/file/or/directory",
  "recursive": true
}
*/
