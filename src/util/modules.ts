import { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { normalize } from "node:path";

import { srcDir } from "../index.js";
import { ModuleSchema, getRegisteredSchema, registerSchema } from "./schema.js";
import { Kind, KINDS } from "./type-helpers.js";

// A built module directory holds foo.js, foo.d.ts, and foo.js.map beside each
// other; a source one holds foo.ts. Both reduce to the same module name.
function moduleName(entry: Dirent): string | undefined {
  if (!entry.isFile()) return undefined;
  if (entry.name.endsWith(".d.ts")) return undefined;

  const match = /^(.+)\.(?:ts|js)$/.exec(entry.name);
  return match ? match[1] : undefined;
}

async function namesIn(kind: Kind): Promise<Array<string>> {
  const entries = await readdir(normalize(`${srcDir}/${kind}s`), {
    withFileTypes: true,
  });
  const names = new Set<string>();

  for (const entry of entries) {
    const name = moduleName(entry);
    if (name !== undefined) names.add(name);
  }

  return [...names].sort();
}

// Reads the four module directories. The filesystem is the registry; nothing
// hard-codes a module list.
export async function listModules(): Promise<Record<Kind, Array<string>>> {
  const pairs = await Promise.all(
    KINDS.map(async (kind) => [kind, await namesIn(kind)] as const),
  );

  return Object.fromEntries(pairs) as Record<Kind, Array<string>>;
}

// Imports the module file and returns its `schema` export. Rejects when the
// type is unknown or the module has no schema.
export async function loadSchema(type: string): Promise<ModuleSchema> {
  const cached = getRegisteredSchema(type);
  if (cached) return cached;

  const [kind, subKind, ...rest] = type.split(":");
  const modules = await listModules();

  if (
    rest.length ||
    !(KINDS as ReadonlyArray<string>).includes(kind) ||
    !modules[kind as Kind].includes(subKind)
  )
    throw new Error(`Unknown module type "${type}".`);

  const namespace = await import(normalize(`${srcDir}/${kind}s/${subKind}.js`));
  const schema = namespace.schema as ModuleSchema | undefined;

  if (!schema) throw new Error(`Module "${type}" declares no schema.`);

  registerSchema(schema);

  return schema;
}
