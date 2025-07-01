// @ts-check

import { Logger } from "pino";
import { globals } from "../index.js";

export interface Globals {
  tasks: Array<any>;
  connections: Array<any>;
  version: string;
  logger: Logger;
}

export class Loggable {
  debug: (obj: string | Record<string, any>, msg?: string) => void;
  info: (obj: string | Record<string, any>, msg?: string) => void;
  error: (obj: string | Record<string, any>, msg?: string) => void;

  constructor() {
    this.debug = (obj, msg) => {
      (globals as Globals).logger.debug(...Loggable.buildLoggerArgs(obj, msg));
    };

    this.info = (obj, msg) => {
      (globals as Globals).logger.info(...Loggable.buildLoggerArgs(obj, msg));
    };

    this.error = (obj, error) => {
      (globals as Globals).logger.error(
        ...Loggable.buildLoggerArgs(obj, error)
      );
    };
  }

  static buildLoggerArgs(
    obj: string | Record<string, any>,
    msgOrError?: string
  ): [Record<string, any>, message: string | undefined] {
    if (typeof obj === "string") {
      msgOrError = obj;
      obj = {};
    }

    return [
      {
        ...obj,
        tags: [...(obj.tags || [])],
      },
      msgOrError,
    ];
  }
}
