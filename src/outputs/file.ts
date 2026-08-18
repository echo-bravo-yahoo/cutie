import { writeFile, appendFile } from "node:fs/promises";

import Output, { OutputConfig } from "../util/Output.js";
import { resolveConfigPath } from "../util/Step.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";
import { ENCODINGS } from "../util/encodings.js";

export interface FileConfig extends OutputConfig {
  path: string;
  append?: boolean;
  insertNewlines?: boolean;
  encoding?: BufferEncoding;
}

export default class File extends Output {
  declare config: FileConfig;

  constructor(config: FileConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async send(message: Message, _traceId: string) {
    if (typeof message !== "string") message = JSON.stringify(message);
    // Trailing, not leading: a leading newline leaves the first line of the
    // file blank and the last line unterminated.
    if (this.config.insertNewlines === true) message = `${message}\n`;

    const path = resolveConfigPath(
      this.interpolateConfigString(this.config.path, { message }),
    );

    if (this.config.append) {
      await appendFile(path, message, { encoding: this.config.encoding });
    } else {
      await writeFile(path, message, { encoding: this.config.encoding });
    }

    return message;
  }
}

export const schema: ModuleSchema = {
  type: "output:file",
  description: "Writes each message to a file.",
  options: {
    path: {
      type: "string",
      description:
        "The file to write, resolved against the config file's directory unless absolute.",
      required: true,
      interpolated: true,
    },
    append: {
      type: "boolean",
      description:
        "Add to the end of the file. False overwrites it on every message.",
      default: true,
    },
    insertNewlines: {
      type: "boolean",
      description:
        "End each message with a newline, so one message is one line.",
      default: true,
    },
    encoding: {
      type: "string",
      description: "How to encode the bytes written.",
      default: "utf8",
      enum: ENCODINGS,
    },
  },
};
