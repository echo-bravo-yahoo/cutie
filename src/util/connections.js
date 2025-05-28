import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals } from "../index.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Step } from "./generic-step.js";
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerConnections(connectionConfigs) {
  const connectionNames = (
    await readdir(normalize(`${__dirname}/../connections`))
  ).map((name) => basename(name, ".js"));

  globals.logger.info({ role: "breadcrumb" }, "Registering connections...");
  const promises = [];

  for (const connectionConfig of connectionConfigs) {
    const connectionTypeInfo = Step.parseTypeString(connectionConfig.type);
    if (connectionNames.includes(connectionTypeInfo.subType)) {
      const Connection = (
        await import(
          normalize(
            `${__dirname}/../${connectionTypeInfo.type}s/${connectionTypeInfo.subType}.js`
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
    (connection) => connection.config.type === connectionType
  );
}

export function getConnectionTriggers(connectionKey) {
  return globals.config.modules.filter(
    (module) => module.name === connectionKey
  );
}
