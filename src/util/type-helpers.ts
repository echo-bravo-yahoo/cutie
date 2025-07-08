import { Configurable } from "./generic-configurable.js";
import { Connection } from "./generic-connection.js";
import Input from "./generic-input.js";
import Output from "./generic-output.js";
import Step from "./generic-step.js";
import Task, { TaskConfig } from "./generic-task.js";
import Transformation from "./generic-transformation.js";
import { TypedConfigurable } from "./generic-typed-configurable.js";

export function isStep(configurable: Configurable): configurable is Step {
  return (
    !isConnection(configurable) &&
    !isTask(configurable) &&
    (isInput(configurable) ||
      isOutput(configurable) ||
      isTransformation(configurable))
  );
}

export function isInput(configurable: Configurable): configurable is Input {
  return !!(
    configurable &&
    (configurable as unknown as TypedConfigurable).type &&
    (configurable as unknown as TypedConfigurable).type.startsWith("input:")
  );
}

export function isOutput(configurable: Configurable): configurable is Output {
  return !!(
    configurable &&
    (configurable as unknown as Output).type &&
    (configurable as unknown as Output).type.startsWith("output:")
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

export function isTransformation(
  configurable: Configurable,
): configurable is Transformation {
  return !!(
    configurable &&
    (configurable as unknown as TypedConfigurable).type &&
    (configurable as unknown as TypedConfigurable).type.startsWith(
      "transformation:",
    )
  );
}
