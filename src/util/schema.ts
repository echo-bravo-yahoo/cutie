export type OptionType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

export interface OptionSchema {
  type: OptionType;
  // One line, required. Drives the generated reference page.
  description: string;
  // Mutually exclusive with `default`.
  required?: boolean;
  default?: unknown;
  // string only
  enum?: ReadonlyArray<string>;
  // number only; both inclusive
  min?: number;
  max?: number;
  integer?: boolean;
  // Documents that ${...} is applied to this value at message time.
  interpolated?: boolean;
  // e.g. "ms", "bytes". Reference page only; no coercion.
  unit?: string;
  // Accepted, warned about, and normalized into `replacedBy`.
  deprecated?: { replacedBy: string };
}

export interface ModuleSchema {
  // The full "kind:subKind" string, e.g. "output:mqtt".
  type: string;
  description: string;
  options: Record<string, OptionSchema>;
  // When true, unknown keys pass without a warning. Wave 1 sets this on every
  // stub; a module is only finished once its schema sets it false (or omits it).
  additionalOptions?: boolean;
}

// Supplied by the validator for every step, so a module schema must not repeat
// them.
export const UNIVERSAL_OPTIONS: ReadonlyArray<string> = [
  "type",
  "name",
  "disabled",
];

// Looked up synchronously from Configurable's constructor, which cannot await
// an import. Both loadSchema and Task.importStep populate it, so any module
// that has been imported has its schema available here.
const schemas = new Map<string, ModuleSchema>();

export function registerSchema(schema: ModuleSchema) {
  schemas.set(schema.type, schema);
}

export function getRegisteredSchema(type: string): ModuleSchema | undefined {
  return schemas.get(type);
}

// Moves every deprecated option onto its replacement, so a module and the
// validator both only ever read the new name. An array-typed replacement wraps
// a scalar, which is what lets `topic: "x"` stand in for `topics: ["x"]`.
export function normalizeDeprecated<T extends object>(
  config: T,
  schema: ModuleSchema,
): T {
  const result = { ...config } as Record<string, unknown>;

  for (const [name, option] of Object.entries(schema.options)) {
    const replacedBy = option.deprecated?.replacedBy;
    if (replacedBy === undefined || result[name] === undefined) continue;

    if (result[replacedBy] === undefined) {
      const replacement = schema.options[replacedBy];
      const value = result[name];
      result[replacedBy] =
        replacement?.type === "array" && !Array.isArray(value)
          ? [value]
          : value;
    }
    delete result[name];
  }

  return result as T;
}

export function applySchemaDefaults<T extends object>(
  config: T,
  schema: ModuleSchema,
): T {
  const result = normalizeDeprecated(config, schema) as Record<string, unknown>;

  for (const [name, option] of Object.entries(schema.options)) {
    if (option.deprecated) continue;
    if (option.default !== undefined && result[name] === undefined)
      result[name] = option.default;
  }

  return result as T;
}
