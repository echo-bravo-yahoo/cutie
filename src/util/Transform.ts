import isArray from "lodash/isArray.js";
import get from "lodash/get.js";
import set from "lodash/set.js";

import Step, { StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";
import { ConfigurableImplementation } from "./Configurable.js";

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
export type TransformConfig = SingleConfig | MultiConfig | WholeMessageConfig;

interface BaseTransformConfig extends StepConfig {
  type: string;
  basePath?: string;
}

export interface SingleConfig extends BaseTransformConfig {
  path: string;
}

export interface MultiConfig extends BaseTransformConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paths: Record<string, any>;
}

export interface WholeMessageConfig extends BaseTransformConfig {}

export function isSingleConfig(
  config: TransformConfig,
): config is SingleConfig {
  return typeof (config as SingleConfig).path === "string" ? true : false;
}

export function isMultiConfig(config: TransformConfig): config is MultiConfig {
  return typeof (config as MultiConfig).paths === "object" ? true : false;
}

export interface Context {
  message: { in: Message; out?: Message };
  basePath?: string;
  path?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paths?: Record<string, any>;
  current: string;
  pathChosen?: string;
}

export default abstract class Transform extends Step {
  declare config: TransformConfig;
  preservePaths: boolean;
  // TO-DO: value's type here is probably string|number|undefined
  abstract transformSingle(
    value: Message,
    config: Message,
    context: Context,
  ): Message;

  constructor(
    config: TransformConfig,
    task: Task,
    implementation: ConfigurableImplementation,
  ) {
    super(config, task, implementation);

    this.preservePaths = true;
  }

  async doHandleMessage(message: Message, traceId: string) {
    return this.transform(message, traceId);
  }

  determineInitialMessageOut(
    isArrayOfReadings: boolean,
    hasBasePath: boolean,
    isPrimitiveReading: boolean,
    messageIn: Message,
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

  transform(message: Message, traceId: string) {
    const isArrayOfReadings = !!(
      this.config.basePath !== undefined ||
      (isArray(message) && message.length)
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
          message,
        ),
      },
      basePath: this.config.basePath,
      path: (this.config as SingleConfig).path,
      paths: (this.config as MultiConfig).paths,
      current: this.config.basePath || "",
    };

    this.debug(
      "Transforming message.",
      { topic: this.logPrefix, traceId },
      {
        isArrayOfReadings,
        isSimpleReading,
        isCompositeReading,
        isPrimitiveReading,
        context,
      },
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
      "Transformed message.",
      { topic: this.logPrefix, traceId },
      {
        context: {
          in: context.message.in,
          out: context.message.out,
        },
      },
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
      context.message.in,
    );
    const newValue = this.transformSingle(oldValue, config, context);

    if (context.current === "") {
      context.message.out = newValue;
    } else {
      if (
        typeof context.message !== "object" ||
        context.message.out === undefined
      )
        context.message.out = {};
      set(context.message.out as unknown as object, context.current, newValue);
    }
  }

  transformPrimitiveReadingArray(context: Context) {
    const array = get(context.message.in, context.current, context.message.in);
    if (!isArray(array)) return;

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformPrimitiveReading(context);
    }
  }

  transformSimpleReadingArray(context: Context) {
    const array = get(context.message.in, context.current, context.message.in);
    if (!isArray(array)) return;

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformSimpleReading(context);
    }
  }

  transformCompositeReadingArray(context: Context) {
    const array = get(context.message.in, context.current, context.message.in);
    if (!isArray(array)) return;

    for (let i = 0; i < array.length; i++) {
      context.current = `${context.basePath || ""}[${i}]`;
      this.transformCompositeReading(context);
    }
  }

  transformCompositeReading(context: Context) {
    for (const path of Object.keys((this.config as MultiConfig).paths || {})) {
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
