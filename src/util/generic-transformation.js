import get from "lodash/get.js";

import { Loggable } from "./generic-loggable.js";

// some notes on terminology:
// a primitive reading is one where the reading is a primitive/literal
//   e.g., message is of type number | Array<number>
// a simple reading is one where the reading is an object and we want one key from that object
//   e.g., message is of type object
//         get(message, path) is of type number
// a composite reading is one where the reading is an object and we want multiple keys from that object
//   e.g., message is of type object
//         get(message, path) is of type number, and we'll do it repeatedly
// a basePath points to an array to iterate through
// a path pulls a value from one of the iterables in the basePath

export class Transformation extends Loggable {
  constructor(config) {
    super();

    this.config = config;
    this.stateKey = config.name || config.type;
  }

  transform(message) {
    const isArrayOfReadings =
      this.config.basePath !== undefined || message.length;
    const isSimpleReading = this.config.path !== undefined;
    const isCompositeReading = this.config.paths !== undefined;
    const isPrimitiveReading = !isSimpleReading && !isCompositeReading;
    const context = {
      message,
      basePath: this.config.basePath,
      path: this.config.path,
      paths: this.config.paths,
      current: this.config.basePath || "",
    };

    if (isArrayOfReadings) {
      if (isPrimitiveReading) {
        return this.transformPrimitiveReadingArray(context);
      } else if (isSimpleReading) {
        return this.transformSimpleReadingArray(context);
      } else if (isCompositeReading) {
        this.transformCompositeReadingArray(context);
      }
    } else {
      if (isPrimitiveReading) {
        return this.transformSimpleReading(context);
      } else if (isSimpleReading) {
        this.transformSimpleReading(context);
      } else if (isCompositeReading) {
        this.transformCompositeReading(context);
      }
    }

    return message;
  }

  transformPrimitiveReadingArray(context) {
    let array = get(context.message, context.current, context.message);
    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformPrimitiveReading(context);
    }
    return context.message;
  }

  transformSimpleReadingArray(context) {
    let array = get(context.message, context.current, context.message);
    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformSimpleReading(context);
    }
    return context.message;
  }

  transformCompositeReadingArray(context) {
    let array = get(context.message, context.current, context.message);
    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformCompositeReading(context);
    }
  }

  transformCompositeReading(context) {
    for (let path of Object.keys(this.config.paths)) {
      this.doTransformSingle({
        ...context,
        current: `${context.current ? `${context.current}.` : ""}${path}`,
        pathChosen: path,
      });
    }
  }

  transformPrimitiveReading(context) {
    return this.transformSimpleReading(context);
  }

  transformSimpleReading(context) {
    return this.doTransformSingle({
      ...context,
      current: `${context.current}${context.path && context.current ? "." : ""}${context.path || ""}`,
    });
  }
}
