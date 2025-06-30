import { globals } from "../index.js";

export class Loggable {
  constructor() {
    this.debug = (obj, msg) => {
      globals.logger.debug(...Loggable.buildLoggerArgs(obj, msg));
    };

    this.info = (obj, msg) => {
      globals.logger.info(...Loggable.buildLoggerArgs(obj, msg));
    };

    this.error = (obj, error) => {
      globals.logger.error(...Loggable.buildLoggerArgs(obj, error));
    };
  }

  static buildLoggerArgs(obj, msgOrError) {
    if (obj.isError && obj.isError()) {
      msgOrError = obj;
      obj = {};
    } else if (typeof obj === "string") {
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
