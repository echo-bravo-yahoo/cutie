import { writeFile, appendFile } from "node:fs/promises";

import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";

export interface FileConfig extends OutputConfig {
  path: string;
  append?: boolean;
}

export default class File extends Output {
  declare config: FileConfig;

  constructor(config: FileConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: FileConfig) {
    return {
      append: true,
      ...config,
    };
  }

  async send(message: any) {
    if (typeof message === "object") message = JSON.stringify(message);

    if (this.config.append) {
      await appendFile(this.config.path, message);
    } else {
      await writeFile(this.config.path, message);
    }

    return message;
  }
}
