import { writeFile, appendFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface FileConfig extends OutputConfig {
  path: string;
  append?: boolean;
  insertNewlines?: boolean;
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
      ...config,
    };
  }

  async send(message: Message) {
    if (typeof message !== "string") message = JSON.stringify(message);
    if (this.config.insertNewlines === true) message = `\n${message}`;

    let path = this.interpolateConfigString(this.config.path, { message });
    if (!isAbsolute(path)) path = resolve(".", path);

    if (this.config.append) {
      // TO-DO: customize encoding
      await appendFile(path, message, { encoding: "utf8" });
    } else {
      await writeFile(path, message, { encoding: "utf8" });
    }

    return message;
  }
}

/*
{
  "type": "output:file",
  "disabled": false,
  "path": "./path/to/file", // gets interpolated
  "append": true,           // false overwrites the file on every message
  "insertNewlines": true    // prefixes each message with a newline
}

Set "append" and "insertNewlines" explicitly. The declared defaults above them
in addDefaultsToConfig are not applied today -- Output never forwards the
implementation argument that would run them -- so an omitted "append" reads as
false and overwrites the file.
*/
