import { readFile } from "node:fs/promises";

import Read, { ReadConfig } from "../util/Read.js";
import { resolveConfigPath } from "../util/Step.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";
import { ENCODINGS } from "../util/encodings.js";

export interface FileConfig extends ReadConfig {
  path: string;
  encoding?: BufferEncoding;
  virtualValue?: string;
}

export default class File extends Read {
  declare config: FileConfig;

  constructor(config: FileConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async read(message: Message, _traceId: string) {
    const path = resolveConfigPath(
      this.interpolateConfigString(this.config.path, { message }),
    );

    return await readFile(path, { encoding: this.config.encoding });
  }

  async virtualRead() {
    return this.config.virtualValue;
  }

  async enable() {
    this.info("Enabled file read.");
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled file read.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:file",
  description: "Replaces the message with the contents of a file.",
  options: {
    path: {
      type: "string",
      description:
        "The file to read, resolved against the config file's directory unless absolute.",
      required: true,
      interpolated: true,
    },
    encoding: {
      type: "string",
      description: "How to decode the file's bytes.",
      default: "utf8",
      enum: ENCODINGS,
    },
    virtual: {
      type: "boolean",
      description: "Return virtualValue instead of reading the file.",
      default: false,
    },
    virtualValue: {
      type: "string",
      description: "What a virtual read returns in place of the file contents.",
      default: "",
    },
  },
};
