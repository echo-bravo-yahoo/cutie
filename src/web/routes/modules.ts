import { Router } from "express";

import { listModules, loadSchema } from "../../util/modules.js";
import { ModuleSchema } from "../../util/schema.js";
import { Kind } from "../../util/type-helpers.js";

type ModuleSchemasByKind = Record<Kind, Record<string, ModuleSchema>>;

// Module schemas do not change without a process restart, so the whole
// payload is built once and cached for the process lifetime.
let cached: ModuleSchemasByKind | undefined;

async function buildModuleSchemas(): Promise<ModuleSchemasByKind> {
  const modules = await listModules();

  const entries = await Promise.all(
    (Object.entries(modules) as Array<[Kind, Array<string>]>).map(
      async ([kind, subKinds]) => {
        const bySubKind = await Promise.all(
          subKinds.map(
            async (subKind) =>
              [subKind, await loadSchema(`${kind}:${subKind}`)] as const,
          ),
        );

        return [kind, Object.fromEntries(bySubKind)] as const;
      },
    ),
  );

  return Object.fromEntries(entries) as ModuleSchemasByKind;
}

export function createModulesRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    if (!cached) cached = await buildModuleSchemas();
    res.json(cached);
  });

  return router;
}
