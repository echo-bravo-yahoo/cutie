import get from "lodash/get.js";
import set from "lodash/set.js";

import Step, { StepConfig } from "./generic-step.js";
import Task from "./generic-task.js";
import { Configurable } from "./generic-configurable.js";

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

interface BaseTransformationConfig extends StepConfig {
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
  return typeof (config as MultiConfig).paths === "object" ? true : false;
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
  declare config: TransformationConfig;
  preservePaths: boolean;
  abstract transformSingle(
    value: number,
    config: any,
    context: Context
  ): number;

  constructor(config: TransformationConfig, task: Task) {
    super(config, task);

    this.preservePaths = true;
  }

  async doHandleMessage(message: any, traceId: string) {
    return this.transform(message, traceId);
  }

  determineInitialMessageOut(
    isArrayOfReadings: boolean,
    hasBasePath: boolean,
    isPrimitiveReading: boolean,
    messageIn: any
  ) {
    if (isArrayOfReadings) {
      if (hasBasePath) {
        return {};
      } else {
        return [];
      }
    } else if (isPrimitiveReading) {
      return undefined;
    } else if (this.preservePaths) {
      return messageIn;
    } else {
      return {};
    }
  }

  transform(message: any, traceId: string) {
    const isArrayOfReadings = !!(
      this.config.basePath !== undefined ||
      (message && message.length)
    );
    const isSimpleReading = isSingleConfig(this.config);
    const isCompositeReading = isMultiConfig(this.config);
    const isPrimitiveReading = !isSimpleReading && !isCompositeReading;

    const context: Context = {
      message: {
        in: message,
        out: this.determineInitialMessageOut(
          isArrayOfReadings,
          !!this.config.basePath,
          isPrimitiveReading,
          message
        ),
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
        context,
      },
      Configurable.prefix("Transforming message.", {
        type: this.config.type,
        traceId,
      })
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
          in: context.message.in,
          out: context.message.out,
        },
      },
      Configurable.prefix("Transforming message.", {
        type: this.config.type,
        traceId,
      })
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

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformPrimitiveReading(context);
    }
  }

  transformSimpleReadingArray(context: Context) {
    let array = get(context.message.in, context.current, context.message.in);

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformSimpleReading(context);
    }
  }

  transformCompositeReadingArray(context: Context) {
    let array = get(context.message.in, context.current, context.message.in);

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformCompositeReading(context);
    }
  }

  transformCompositeReading(context: Context) {
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
