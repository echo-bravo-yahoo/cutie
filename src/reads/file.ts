import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface FileConfig extends ReadConfig {
  path: string;
  encoding?: BufferEncoding;
}

export default class File extends Read {
  declare config: FileConfig;

  constructor(config: FileConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: FileConfig): FileConfig {
    return {
      encoding: "utf8",
      ...config,
    };
  }

  async read(message: Message, _traceId: string) {
    let path = this.interpolateConfigString(this.config.path, { message });
    if (!isAbsolute(path)) path = resolve(".", path);
    return await readFile(path, { encoding: this.config.encoding });
  }

  async enable() {
    this.info("Enabled file read.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled file read.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "read:file",
  "disabled": false,
  "path": "./path/to/file", // gets interpolated
  "encoding": "utf8"        // default; any encoding node's fs accepts
}
*/
