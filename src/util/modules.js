import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals } from "../index.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerModules(moduleConfigs) {
  const moduleNames = (await readdir(normalize(`${__dirname}/../modules`))).map(
    (name) => basename(name, ".js")
  );

  globals.logger.info({ role: "breadcrumb" }, "Registering modules...");
  const promises = [];

  for (const moduleConfig of moduleConfigs) {
    if (moduleNames.includes(moduleConfig.type)) {
      const Module = (
        await import(
          normalize(`${__dirname}/../modules/${moduleConfig.type}.js`)
        )
      ).default;

      const newIndex = globals.modules.length;
      const newModule = new Module(moduleConfig);

      console.log(newModule);
      globals.modules.push(newModule);
      promises.push(newModule.register());
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered module of type ${moduleConfig.type} in index ${newIndex}.`
      );
    }
  }

  await Promise.all(promises);
  globals.logger.info({ role: "breadcrumb" }, "Module registration completed.");
}

export function getModule(moduleKey) {
  return globals.modules.find((module) => module.name === moduleKey);
}
