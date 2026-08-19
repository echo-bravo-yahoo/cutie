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

// Accepted by every step, whatever its type, so a module schema must not
// repeat them. Declared as schemas rather than as a list of names because two
// readers need more than the names: the validator type-checks them, and the
// reference generator renders them into every module's table.
export const UNIVERSAL_OPTION_SCHEMAS: Record<string, OptionSchema> = {
  type: {
    type: "string",
    description: 'Which module this step is, as "kind:subKind".',
    required: true,
  },
  name: {
    type: "string",
    description: "A label for this step, used in error messages.",
  },
  disabled: {
    type: "boolean",
    description: "Leave this step out of the task.",
    default: false,
  },
  rescue: {
    type: "string",
    description:
      "Which task to run when this step fails, defaulting to the one its own task names. The rescue is handed the failed message and an ${error...} namespace; what it returns through control:return takes the message's place, and if it returns nothing the message ends there.",
  },
};

export const UNIVERSAL_OPTIONS: ReadonlyArray<string> = Object.keys(
  UNIVERSAL_OPTION_SCHEMAS,
);

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

export function applySchemaDefaults<T extends object>(
  config: T,
  schema: ModuleSchema,
): T {
  const result = { ...config } as Record<string, unknown>;

  for (const [name, option] of Object.entries(schema.options)) {
    if (option.default !== undefined && result[name] === undefined)
      result[name] = option.default;
  }

  return result as T;
}
