import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals, srcDir } from "../index.js";

import { Step } from "./generic-step.js";

export async function registerConnections(connectionConfigs) {
  const connectionNames = (
    await readdir(normalize(`${srcDir}/connections`))
  ).map((name) => basename(name, ".js"));

  const localLogger = globals.logger.child(
    {},
    {
      msgPrefix: "[core.registration.connections] ",
      redact: ["context.password", "context.username", "context.token"],
    }
  );
  localLogger.info("Registering connections...");
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

      const newConnection = new Connection(connectionConfig);

      globals.connections.push(newConnection);
      promises.push(newConnection.register());
      localLogger.info("Registered connection.");
    }
  }

  await Promise.all(promises);
  localLogger.info("Connection registration completed.");
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
