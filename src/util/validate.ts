import { listModules, loadSchema } from "./modules.js";
import {
  ModuleSchema,
  OptionSchema,
  OptionType,
  UNIVERSAL_OPTIONS,
} from "./schema.js";
import { Kind, KINDS } from "./type-helpers.js";

export interface ConfigError {
  severity: "error" | "warning";
  // Dotted path into the config, e.g. "tasks.rebroadcast-temp.steps[2].precision"
  // or "connections[0].endpoint". Top-level keys have no prefix.
  path: string;
  message: string;
}

type Modules = Record<Kind, Array<string>>;

const NAME_PATTERN = /^[a-z0-9-]+$/;

function error(path: string, message: string): ConfigError {
  return { severity: "error", path, message };
}

function warning(path: string, message: string): ConfigError {
  return { severity: "warning", path, message };
}

// Reported as the type the reader would name, so "expected object, found
// object" never happens for an array or a null.
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesType(value: unknown, type: OptionType): boolean {
  switch (type) {
    case "any":
      return true;
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    default:
      return typeof value === type;
  }
}

function bound(value: number | undefined, fallback: string): string {
  return value === undefined ? fallback : `${value}`;
}

function validateOption(
  value: unknown,
  option: OptionSchema,
  path: string,
  errors: Array<ConfigError>,
) {
  if (!matchesType(value, option.type)) {
    errors.push(
      error(path, `expected ${option.type}, found ${describeType(value)}`),
    );
    return;
  }

  if (option.enum && typeof value === "string" && !option.enum.includes(value))
    errors.push(
      error(path, `"${value}" is not one of: ${option.enum.join(", ")}`),
    );

  if (typeof value !== "number") return;

  if (option.integer && !Number.isInteger(value))
    errors.push(error(path, `${value} is not an integer`));

  const belowMin = option.min !== undefined && value < option.min;
  const aboveMax = option.max !== undefined && value > option.max;

  if (belowMin || aboveMax)
    errors.push(
      error(
        path,
        `${value} is out of range; expected ${bound(option.min, "-Infinity")} to ${bound(option.max, "Infinity")}`,
      ),
    );
}

function validateOptions(
  config: Record<string, unknown>,
  schema: ModuleSchema,
  path: string,
  errors: Array<ConfigError>,
) {
  for (const [name, option] of Object.entries(schema.options)) {
    const value = config[name];

    if (value === undefined) {
      if (option.required)
        errors.push(
          error(
            `${path}.${name}`,
            `missing required option; expected ${option.type}`,
          ),
        );
      continue;
    }

    validateOption(value, option, `${path}.${name}`, errors);
  }

  if (schema.additionalOptions) return;

  for (const name of Object.keys(config)) {
    if (UNIVERSAL_OPTIONS.includes(name)) continue;
    if (schema.options[name]) continue;
    errors.push(
      warning(`${path}.${name}`, `unknown option for ${schema.type}`),
    );
  }
}

// Resolves a step or connection's `type` without importing anything, so a
// traversal-shaped subKind never reaches a dynamic import.
function resolveType(
  value: unknown,
  path: string,
  modules: Modules,
  errors: Array<ConfigError>,
): { kind: Kind; subKind: string } | undefined {
  if (value === undefined) {
    errors.push(
      error(`${path}.type`, "missing required option; expected string"),
    );
    return undefined;
  }

  if (typeof value !== "string") {
    errors.push(
      error(`${path}.type`, `expected string, found ${describeType(value)}`),
    );
    return undefined;
  }

  const parts = value.split(":");

  if (parts.length !== 2) {
    errors.push(
      error(`${path}.type`, `expected a "kind:subKind" type, found "${value}"`),
    );
    return undefined;
  }

  const [kind, subKind] = parts;

  if (
    !NAME_PATTERN.test(kind) ||
    !(KINDS as ReadonlyArray<string>).includes(kind)
  ) {
    errors.push(
      error(
        `${path}.type`,
        `unknown kind "${kind}"; expected one of: ${[...KINDS].sort().join(", ")}`,
      ),
    );
    return undefined;
  }

  const available = modules[kind as Kind];

  if (!NAME_PATTERN.test(subKind) || !available.includes(subKind)) {
    errors.push(
      error(
        `${path}.type`,
        `unknown ${kind} type "${subKind}"; expected one of: ${available.join(", ")}`,
      ),
    );
    return undefined;
  }

  return { kind: kind as Kind, subKind };
}

interface ModuleContext {
  modules: Modules;
  connectionNames: Set<string>;
  disabledConnectionNames: Set<string>;
  errors: Array<ConfigError>;
}

// `expectedKind` is what the slot accepts: a task's trigger takes a trigger, a
// step takes anything else, and a connections entry takes a connection.
async function validateModule(
  value: unknown,
  path: string,
  expects: { kind?: Kind; not?: Kind; label: string },
  context: ModuleContext,
) {
  const { errors } = context;

  if (!isRecord(value)) {
    errors.push(error(path, `expected object, found ${describeType(value)}`));
    return;
  }

  const resolved = resolveType(value.type, path, context.modules, errors);
  if (!resolved) return;

  if (
    (expects.kind !== undefined && resolved.kind !== expects.kind) ||
    (expects.not !== undefined && resolved.kind === expects.not)
  ) {
    errors.push(
      error(`${path}.type`, `expected ${expects.label}, found "${value.type}"`),
    );
    return;
  }

  if (typeof value.connectionName === "string") {
    if (!context.connectionNames.has(value.connectionName))
      errors.push(
        error(
          `${path}.connectionName`,
          `no connection named "${value.connectionName}" is declared`,
        ),
      );
    else if (context.disabledConnectionNames.has(value.connectionName))
      errors.push(
        error(
          `${path}.connectionName`,
          `connection "${value.connectionName}" is declared but disabled`,
        ),
      );
  }

  let schema: ModuleSchema;
  try {
    schema = await loadSchema(value.type as string);
  } catch (schemaError) {
    errors.push(error(`${path}.type`, `${(schemaError as Error).message}`));
    return;
  }

  validateOptions(value, schema, path, errors);
}

async function validateConnections(
  value: unknown,
  context: ModuleContext,
): Promise<void> {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    context.errors.push(
      error("connections", `expected array, found ${describeType(value)}`),
    );
    return;
  }

  for (const [index, connection] of value.entries()) {
    const path = `connections[${index}]`;

    await validateModule(
      connection,
      path,
      { kind: "connection", label: "a connection" },
      context,
    );

    // Unlike a step's, a connection's name is how every step refers to it.
    if (isRecord(connection) && connection.name === undefined)
      context.errors.push(
        error(`${path}.name`, "missing required option; expected string"),
      );
  }
}

function declaredConnectionNames(
  value: unknown,
  onlyDisabled = false,
): Set<string> {
  const names = new Set<string>();

  if (!Array.isArray(value)) return names;

  for (const connection of value)
    if (
      isRecord(connection) &&
      typeof connection.name === "string" &&
      (!onlyDisabled || connection.disabled === true)
    )
      names.add(connection.name);

  return names;
}

async function validateTasks(
  value: unknown,
  context: ModuleContext,
): Promise<void> {
  if (value === undefined) return;

  if (!isRecord(value)) {
    context.errors.push(
      error("tasks", `expected object, found ${describeType(value)}`),
    );
    return;
  }

  for (const [name, task] of Object.entries(value)) {
    const path = `tasks.${name}`;

    if (!isRecord(task)) {
      context.errors.push(
        error(path, `expected object, found ${describeType(task)}`),
      );
      continue;
    }

    if (task.trigger !== undefined)
      await validateModule(
        task.trigger,
        `${path}.trigger`,
        { kind: "trigger", label: "a trigger" },
        context,
      );

    if (task.steps === undefined) continue;

    if (!Array.isArray(task.steps)) {
      context.errors.push(
        error(
          `${path}.steps`,
          `expected array, found ${describeType(task.steps)}`,
        ),
      );
      continue;
    }

    for (const [index, step] of task.steps.entries())
      await validateModule(
        step,
        `${path}.steps[${index}]`,
        { not: "trigger", label: "a step" },
        context,
      );
  }
}

// Never throws for a bad config; collects everything. Throws only on an
// internal failure such as an unreadable module directory.
export async function validateConfig(
  config: unknown,
  opts: { configPath: string },
): Promise<Array<ConfigError>> {
  const errors: Array<ConfigError> = [];

  if (!isRecord(config))
    return [
      error(
        "",
        `expected object, found ${describeType(config)} in "${opts.configPath}"`,
      ),
    ];

  if (Object.keys(config).length === 0)
    return [error("", `no configuration found in "${opts.configPath}"`)];

  const context: ModuleContext = {
    modules: await listModules(),
    connectionNames: declaredConnectionNames(config.connections),
    disabledConnectionNames: declaredConnectionNames(config.connections, true),
    errors,
  };

  await validateConnections(config.connections, context);
  await validateTasks(config.tasks, context);

  if (isRecord(config.configProvider)) {
    const name = config.configProvider.connectionName;
    if (typeof name === "string" && !context.connectionNames.has(name))
      errors.push(
        error(
          "configProvider.connectionName",
          `no connection named "${name}" is declared`,
        ),
      );
  }

  return errors;
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Errors first, then warnings, one per line, then a count.
export function formatConfigErrors(errors: ReadonlyArray<ConfigError>): string {
  const problems = errors.filter((entry) => entry.severity === "error");
  const warnings = errors.filter((entry) => entry.severity === "warning");
  const lines = [...problems, ...warnings].map(
    (entry) =>
      `${entry.severity} ${entry.path || "<config>"}: ${entry.message}`,
  );

  return [
    ...lines,
    `Found ${count(problems.length, "error")} and ${count(warnings.length, "warning")}.`,
  ].join("\n");
}

export function hasConfigError(errors: ReadonlyArray<ConfigError>): boolean {
  return errors.some((entry) => entry.severity === "error");
}

// The one place `cutie validate` and start()'s pre-pass print through. Returns
// whether the config should be refused.
export function reportConfigErrors(
  errors: ReadonlyArray<ConfigError>,
): boolean {
  if (errors.length) console.error(formatConfigErrors(errors));

  return hasConfigError(errors);
}
