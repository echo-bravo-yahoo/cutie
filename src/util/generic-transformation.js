import get from "lodash/get.js";
import set from "lodash/set.js";
import { Step } from "./generic-step.js";

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

export class Transformation extends Step {
  constructor(config, task) {
    super(config, task);

    this.preservePaths = true;
  }

  async handleMessage(message) {
    const transformed = this.transform(message);
    if (this.next) {
      return this.next.handleMessage(transformed);
    } else {
      return transformed;
    }
  }

  transform(message) {
    const isArrayOfReadings =
      this.config.basePath !== undefined || message.length;
    const isSimpleReading = this.config.path !== undefined;
    const isCompositeReading = this.config.paths !== undefined;
    const isPrimitiveReading = !isSimpleReading && !isCompositeReading;
    const context = {
      message: {
        in: message,
        out: undefined,
      },
      basePath: this.config.basePath,
      path: this.config.path,
      paths: this.config.paths,
      current: this.config.basePath || "",
    };

    // console.log("isArrayOfReadings", isArrayOfReadings);
    // console.log("isSimpleReading", isSimpleReading);
    // console.log("isCompositeReading", isCompositeReading);
    // console.log("isPrimitiveReading", isPrimitiveReading);

    if (isArrayOfReadings) {
      if (isPrimitiveReading) {
        this.transformPrimitiveReadingArray(context);
      } else if (isSimpleReading) {
        this.transformSimpleReadingArray(context);
      } else if (isCompositeReading) {
        this.transformCompositeReadingArray(context);
      }
    } else {
      if (isPrimitiveReading) {
        this.transformPrimitiveReading(context);
      } else if (isSimpleReading) {
        this.transformSimpleReading(context);
      } else if (isCompositeReading) {
        this.transformCompositeReading(context);
      }
    }

    // console.log(
    //   `Transformed message from ${JSON.stringify(context.message.in)} to ${JSON.stringify(context.message.out)}`
    // );
    return context.message.out;
  }

  doTransformSingle(context) {
    const config = context.pathChosen
      ? this.config.paths[context.pathChosen]
      : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in,
    );
    const newValue = this.transformSingle(oldValue, config, context);

    // console.log(
    //   "Context before transforming single value",
    //   JSON.stringify(context, null, 2)
    // );
    if (context.current === "") {
      context.message.out = newValue;
    } else {
      if (context.message.out === undefined) context.message.out = {};
      set(context.message.out, context.current, newValue);
    }
    // console.log(
    //   "Context after transforming single value",
    //   JSON.stringify(context, null, 2)
    // );
  }

  transformPrimitiveReadingArray(context) {
    let array = get(context.message.in, context.current, context.message.in);
    if (context.message.out === undefined) {
      if (context.basePath) {
        context.message.out = {};
      } else {
        context.message.out = [];
      }
    }

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformPrimitiveReading(context);
    }
  }

  transformSimpleReadingArray(context) {
    let array = get(context.message.in, context.current, context.message.in);
    if (context.message.out === undefined) {
      if (context.basePath) {
        context.message.out = {};
      } else {
        context.message.out = [];
      }
    }

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformSimpleReading(context);
    }
  }

  transformCompositeReadingArray(context) {
    let array = get(context.message.in, context.current, context.message.in);
    if (context.message.out === undefined) {
      if (context.basePath) {
        context.message.out = {};
      } else {
        context.message.out = [];
      }
    }

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformCompositeReading(context);
    }
  }

  transformCompositeReading(context) {
    const allPaths = context.current
      ? Object.keys(get(context.message.in, context.current))
      : Object.keys(context.message.in);

    // console.log(`allPaths: ${JSON.stringify(allPaths)}`);

    // TO-DO: figure out where this logical should (centrally) live

    if (context.message.out === undefined) context.message.out = {};
    // copy every path so we don't drop any
    if (this.preservePaths) {
      for (let path of allPaths) {
        // console.log(
        //   `Setting message path ${path} to value ${get(context.message.in, path)}.`
        // );
        set(
          context.message.out,
          `${context.current ? `${context.current}.` : ""}${path}`,
          get(context.message.in, path),
        );
      }
    }
    // console.log("OUT:", context.message.out);

    // overwrite the specific paths
    for (let path of Object.keys(this.config.paths)) {
      this.doTransformSingle({
        ...context,
        current: `${context.current ? `${context.current}.` : ""}${path}`,
        pathChosen: path,
      });
    }
  }

  transformPrimitiveReading(context) {
    this.doTransformSingle({
      ...context,
      current: `${context.current}${context.path && context.current ? "." : ""}${context.path || ""}`,
    });
  }

  transformSimpleReading(context) {
    this.doTransformSingle({
      ...context,
      current: `${context.current}${context.path && context.current ? "." : ""}${context.path || ""}`,
    });
  }
}
