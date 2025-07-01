import get from "lodash/get.js";
import set from "lodash/set.js";

import Step from "./generic-step.js";
import Task from "./generic-task.js";

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
export type TransformationConfig =
  | SingleConfig
  | MultiConfig
  | WholeMessageConfig;

interface BaseTransformationConfig {
  type: string;
  basePath?: string;
}

export interface SingleConfig extends BaseTransformationConfig {
  path: string;
}

export interface MultiConfig extends BaseTransformationConfig {
  paths: Record<string, any>;
}

export interface WholeMessageConfig extends BaseTransformationConfig {}

export function isSingleConfig(
  config: TransformationConfig
): config is SingleConfig {
  return typeof (config as SingleConfig).path === "string" ? true : false;
}

export function isMultiConfig(
  config: TransformationConfig
): config is MultiConfig {
  return typeof (config as MultiConfig).paths ? true : false;
}

export interface Context {
  message: { in: any; out?: any };
  basePath?: string;
  path?: string;
  paths?: Record<string, any>;
  current: string;
  pathChosen?: string;
}

export default abstract class Transformation extends Step {
  config: TransformationConfig;
  preservePaths: boolean;
  abstract transformSingle(value: any, config: any, context: Context): any;

  constructor(config: TransformationConfig, task: Task) {
    super(config, task);

    this.preservePaths = true;
  }

  async handleMessage(message: any) {
    const transformed = this.transform(message);
    if (this.next) {
      return this.next.handleMessage(transformed);
    } else {
      return transformed;
    }
  }

  transform(message: any) {
    const isArrayOfReadings =
      this.config.basePath !== undefined || message.length;
    const isSimpleReading = isSingleConfig(this.config);
    const isCompositeReading = isMultiConfig(this.config);
    const isPrimitiveReading = !isSimpleReading && !isCompositeReading;

    const context: Context = {
      message: {
        in: message,
        out: undefined,
      },
      basePath: this.config.basePath,
      path: (this.config as SingleConfig).path,
      paths: (this.config as MultiConfig).paths,
      current: this.config.basePath || "",
    };

    this.debug(
      {
        isArrayOfReadings,
        isSimpleReading,
        isCompositeReading,
        isPrimitiveReading,
        message,
      },
      "Transforming message."
    );

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

    this.debug(
      {
        context: {
          before: context.message.in,
          after: context.message.out,
        },
      },
      "Transformed message."
    );

    return context.message.out;
  }

  doTransformSingle(context: Context) {
    const config =
      context.pathChosen && isMultiConfig(this.config)
        ? this.config.paths[context.pathChosen]
        : this.config;
    const oldValue = get(
      context.message.in,
      context.current,
      context.message.in
    );
    const newValue = this.transformSingle(oldValue, config, context);

    if (context.current === "") {
      context.message.out = newValue;
    } else {
      if (context.message.out === undefined) context.message.out = {};
      set(context.message.out, context.current, newValue);
    }
  }

  transformPrimitiveReadingArray(context: Context) {
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

  transformSimpleReadingArray(context: Context) {
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

  transformCompositeReadingArray(context: Context) {
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

  transformCompositeReading(context: Context) {
    const allPaths = context.current
      ? Object.keys(get(context.message.in, context.current))
      : Object.keys(context.message.in);

    // TO-DO: figure out where this logical should (centrally) live
    if (context.message.out === undefined) context.message.out = {};

    // copy every path so we don't drop any
    if (this.preservePaths) {
      for (let path of allPaths) {
        set(
          context.message.out,
          `${context.current ? `${context.current}.` : ""}${path}`,
          get(context.message.in, path)
        );
      }
    }

    // overwrite the specific paths
    for (let path of Object.keys((this.config as MultiConfig).paths || {})) {
      this.doTransformSingle({
        ...context,
        current: `${context.current ? `${context.current}.` : ""}${path}`,
        pathChosen: path,
      });
    }
  }

  transformPrimitiveReading(context: Context) {
    this.doTransformSingle({
      ...context,
      current: `${context.current}${context.path && context.current ? "." : ""}${context.path || ""}`,
    });
  }

  transformSimpleReading(context: Context) {
    this.doTransformSingle({
      ...context,
      current: `${context.current}${context.path && context.current ? "." : ""}${context.path || ""}`,
    });
  }
}
