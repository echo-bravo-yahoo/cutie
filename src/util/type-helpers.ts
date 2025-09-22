import { Configurable } from "./Configurable.js";
import { Connection } from "./Connection.js";
import Trigger from "./Trigger.js";
import Output from "./Output.js";
import Step from "./Step.js";
import Task, { TaskConfig } from "./Task.js";
import Transform from "./Transform.js";
import { TypedConfigurable } from "./TypedConfigurable.js";

export interface ProviderConfig {
  connectionName: "string";
}

export function isStep(configurable: Configurable): configurable is Step {
  return (
    !isConnection(configurable) &&
    !isTask(configurable) &&
    (isTrigger(configurable) ||
      isOutput(configurable) ||
      isTransform(configurable))
  );
}

export function isTrigger(configurable: Configurable): configurable is Trigger {
  return !!(
    configurable &&
    (configurable as unknown as TypedConfigurable).type &&
    (configurable as unknown as TypedConfigurable).type.startsWith("trigger")
  );
}

export function isOutput(configurable: Configurable): configurable is Output {
  return !!(
    configurable &&
    (configurable as unknown as Output).type &&
    (configurable as unknown as Output).type.startsWith("output")
  );
}

export function isTask(configurable: Configurable): configurable is Task {
  return (
    configurable &&
    (configurable as unknown as TaskConfig).steps &&
    (configurable as unknown as TaskConfig).steps.length !== undefined
  );
}

export function isConnection(
  configurable: Configurable,
): configurable is Connection {
  return !!(
    configurable &&
    (configurable as unknown as TypedConfigurable).type &&
    (configurable as unknown as TypedConfigurable).type.startsWith(
      "connection:",
    )
  );
}

export function isTransform(
  configurable: Configurable,
): configurable is Transform {
  return !!(
    configurable &&
    (configurable as unknown as TypedConfigurable).type &&
    (configurable as unknown as TypedConfigurable).type.startsWith("transform:")
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Message = number | string | Record<string, any> | undefined;
