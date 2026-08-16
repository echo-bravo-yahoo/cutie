import { writeFile, appendFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface FileConfig extends OutputConfig {
  path: string;
  append?: boolean;
  insertNewlines?: boolean;
  encoding?: BufferEncoding;
}

export default class File extends Output {
  declare config: FileConfig;

  constructor(config: FileConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: FileConfig): FileConfig {
    return {
      append: true,
      insertNewlines: true,
      encoding: "utf8",
      ...config,
    };
  }

  async send(message: Message, _traceId: string) {
    if (typeof message !== "string") message = JSON.stringify(message);
    if (this.config.insertNewlines === true) message = `\n${message}`;

    let path = this.interpolateConfigString(this.config.path, { message });
    if (!isAbsolute(path)) path = resolve(".", path);

    if (this.config.append) {
      await appendFile(path, message, { encoding: this.config.encoding });
    } else {
      await writeFile(path, message, { encoding: this.config.encoding });
    }

    return message;
  }
}

/*
{
  "type": "output:file",
  "disabled": false,
  "path": "./path/to/file", // gets interpolated
  "append": true,           // default; false overwrites the file on every message
  "insertNewlines": true,   // default; prefixes each message with a newline
  "encoding": "utf8"        // default; any encoding node's fs accepts
}
*/
