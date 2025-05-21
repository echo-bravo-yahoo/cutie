import get from "lodash/get.js";
import set from "lodash/set.js";

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

    if (isArrayOfReadings) {
      if (isSimpleReading || isPrimitiveReading) {
        return this.transformSimpleReadingArray(message);
      } else if (isCompositeReading) {
        return this.transformCompositeReadingArray(message);
      }
    } else {
      if (isPrimitiveReading) {
        return this.transformPrimitiveReading(message);
      } else if (isSimpleReading) {
        return set(
          message,
          this.config.path,
          this.transformSimpleReading(message)
        );
      } else if (isCompositeReading) {
        return this.transformCompositeReading(message);
      }
    }
  }

  transformSimpleReadingArray(message) {
    let array = get(message, this.config.basePath, message);
    array = array.map((reading) => {
      if (this.config.path) {
        return set(
          reading,
          this.config.path,
          this.transformSimpleReading(reading)
        );
      } else {
        return this.transformSimpleReading(reading);
      }
    });

    if (!this.config.basePath) {
      message = array;
    } else {
      message = set(message, this.config.basePath, array);
    }
    return message;
  }

  transformCompositeReadingArray(message) {
    let array = get(message, this.config.basePath, message);
    array = array.map((reading) => {
      return this.transformCompositeReading(reading);
    });

    if (!this.config.basePath) {
      message = array;
    } else {
      message = set(message, this.config.basePath, array);
    }
    return message;
  }

  transformPrimitiveReading(message) {
    return this.transformSimpleReading(message);
  }

  transformCompositeReading(message) {
    for (let [path, options] of Object.entries(this.config.paths)) {
      const original = get(message, path);
      const transformed = this.transformSimpleReading(original, options);
      message = set(message, path, transformed);
    }

    return message;
  }

  transformSimpleReading(value, option = this.config) {
    if (option.path) {
      return this.doTransformSingle(get(value, option.path), option);
    }
    return this.doTransformSingle(value, option);
  }
}
