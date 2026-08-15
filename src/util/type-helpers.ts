import { Configurable } from "./Configurable.js";
import { Connection } from "./Connection.js";
import Trigger from "./Trigger.js";
import Output from "./Output.js";
import Read from "./Read.js";
import Step from "./Step.js";
import Task, { TaskConfig } from "./Task.js";
import Transform from "./Transform.js";

export const KINDS = [
  "trigger",
  "read",
  "transform",
  "output",
  "connection",
] as const;

export type Kind = (typeof KINDS)[number];

export interface ProviderConfig {
  connectionName: string;
}

export function isStep(configurable: Configurable): configurable is Step {
  return (
    !isConnection(configurable) &&
    !isTask(configurable) &&
    (isTrigger(configurable) ||
      isOutput(configurable) ||
      isTransform(configurable) ||
      isRead(configurable))
  );
}

// A config's `type` is the whole "kind:subKind" string, but an instance stores
// the two halves separately, so match against the parsed half only.
function isKind<T extends Configurable>(
  configurable: Configurable,
  kind: Kind,
): configurable is T {
  return !!configurable && configurable.kind === kind;
}

export const isTrigger = (c: Configurable): c is Trigger =>
  isKind(c, "trigger");
export const isRead = (c: Configurable): c is Read => isKind(c, "read");
export const isTransform = (c: Configurable): c is Transform =>
  isKind(c, "transform");
export const isOutput = (c: Configurable): c is Output => isKind(c, "output");
export const isConnection = (c: Configurable): c is Connection =>
  isKind(c, "connection");

export function isTask(configurable: Configurable): configurable is Task {
  return (
    configurable &&
    (configurable as unknown as TaskConfig).steps &&
    (configurable as unknown as TaskConfig).steps.length !== undefined
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Message = number | string | Record<string, any> | undefined;
