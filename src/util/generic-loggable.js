import { globals } from "../index.js";

export class Loggable {
  constructor() {
    this.debug = (obj, msg, args) => {
      if (typeof obj === "string") {
        msg = obj;
        obj = {};
      }

      globals.logger.debug(
        {
          role: "breadcrumb",
          ...obj,
          tags: [...(obj.tags || []), this.stateKey],
        },
        msg,
        args
      );
    };

    this.info = (obj, msg, args) => {
      if (typeof obj === "string") {
        msg = obj;
        obj = {};
      }

      globals.logger.info(
        {
          role: "breadcrumb",
          ...obj,
          tags: [...(obj.tags || []), this.stateKey],
        },
        msg,
        args
      );
    };

    this.error = (obj, msg, args) => {
      if (typeof obj === "string") {
        msg = obj;
        obj = {};
      }

      globals.logger.error(obj, msg, args);
      /*
      globals.logger.error({
        ...obj,
        role: 'breadcrumb',
        tags: [...(obj.tags || []), this.stateKey]
      }, msg, args)
      */
    };
  }
}
