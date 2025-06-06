import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals, srcDir } from "../index.js";

import { Step } from "./generic-step.js";

export async function registerConnections(connectionConfigs) {
  const connectionNames = (
    await readdir(normalize(`${srcDir}/connections`))
  ).map((name) => basename(name, ".js"));

  globals.logger.info({ role: "breadcrumb" }, "Registering connections...");
  const promises = [];

  for (const connectionConfig of connectionConfigs) {
    const connectionTypeInfo = Step.parseTypeString(connectionConfig.type);
    if (connectionNames.includes(connectionTypeInfo.subType)) {
      const Connection = (
        await import(
          normalize(
            `${srcDir}/${connectionTypeInfo.type}s/${connectionTypeInfo.subType}.js`
          )
        )
      ).default;

      const newIndex = globals.connections.length;
      const newConnection = new Connection(connectionConfig);

      globals.connections.push(newConnection);
      promises.push(newConnection.register());
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered connection of type ${connectionConfig.type} in index ${newIndex}.`
      );
    }
  }

  await Promise.all(promises);
  globals.logger.info(
    { role: "breadcrumb" },
    "Connection registration completed."
  );
}

export function getConnection(connectionKey) {
  return globals.connections.find(
    (connection) => connection.name === connectionKey
  );
}

export function getConnectionsByType(connectionType) {
  return globals.connections.filter(
    (connection) => connection.config.type.split(":")[1] === connectionType
  );
}

export function getConnectionTriggers(connectionKey) {
  return globals.config.modules.filter(
    (module) => module.name === connectionKey
  );
}
