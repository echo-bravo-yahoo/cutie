// Hand-copied from src/util/schema.ts, src/util/configs.ts, src/util/Task.ts,
// src/util/validate.ts, and src/util/type-helpers.ts in the main package: this
// frontend is a separate npm package with its own build, so it cannot import
// those directly. Keep this file in sync with a schema change there.

export type OptionType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

export interface OptionSchema {
  type: OptionType;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: ReadonlyArray<string>;
  min?: number;
  max?: number;
  integer?: boolean;
  interpolated?: boolean;
  unit?: string;
}

export interface ModuleSchema {
  type: string;
  description: string;
  options: Record<string, OptionSchema>;
  additionalOptions?: boolean;
}

export const KINDS = [
  "trigger",
  "read",
  "transform",
  "control",
  "output",
  "connection",
] as const;

export type Kind = (typeof KINDS)[number];

export type ModuleSchemasByKind = Record<Kind, Record<string, ModuleSchema>>;

export function moduleSchemaFor(
  modules: ModuleSchemasByKind,
  type: string,
): ModuleSchema | undefined {
  const [kind, subKind] = type.split(":");
  return modules[kind as Kind]?.[subKind];
}

// Every step accepts these four regardless of type; declared once here as
// UNIVERSAL_OPTION_SCHEMAS is on the server, since a step's own ModuleSchema
// never repeats them.
export const UNIVERSAL_FIELDS = ["name", "disabled", "rescue"] as const;

// A step or a trigger: anything with a "kind:subKind" type string. Options
// beyond the universal fields vary by type, so this is deliberately loose.
export interface StepConfig {
  type: string;
  name?: string;
  disabled?: boolean;
  rescue?: string;
  [option: string]: unknown;
}

export interface TaskConfig {
  trigger?: StepConfig;
  steps?: Array<StepConfig>;
  rescue?: string;
  data?: Record<string, unknown>;
}

export interface ConnectionConfig {
  type: string;
  name: string;
  disabled?: boolean;
  [option: string]: unknown;
}

export interface ProviderConfig {
  connectionName: string;
  topic?: string;
}

export interface ConfigFile {
  configProvider?: ProviderConfig;
  connections: Array<ConnectionConfig>;
  // A Record keyed by task name, matching how the runtime and validator
  // actually treat it (src/util/validate.ts's declaredTaskNames), not the
  // `Array<TaskConfig>` the server's own ConfigFile type currently declares.
  tasks?: Record<string, TaskConfig>;
}

export interface ConfigError {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export type NodesResponse = Record<string, ConfigFile>;

export interface PublishResult {
  ok: boolean;
  errors?: Array<ConfigError>;
  warnings?: Array<ConfigError>;
}
