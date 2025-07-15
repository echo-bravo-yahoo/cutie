import { writeFile, appendFile } from "node:fs/promises";

import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";

export interface FileConfig extends OutputConfig {
  path: string;
  spaces?: number;
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
    if (this.config.append) {
      await appendFile(
        this.config.path,
        JSON.stringify(message, null, this.config.spaces),
      );
    } else {
      await writeFile(
        this.config.path,
        JSON.stringify(message, null, this.config.spaces),
      );
    }

    return message;
  }
}
