import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals, srcDir } from "../index.js";

import Step from "./generic-step.js";
import { ConnectionConfig } from "./generic-connection.js";
import { Globals } from "./generic-loggable.js";

export async function registerConnections(
  connectionConfigs: Array<ConnectionConfig>
) {
  const connectionNames = (
    await readdir(normalize(`${srcDir}/connections`))
  ).map((name) => basename(name, ".js"));

  const localLogger = (globals as Globals).logger.child(
    {},
    {
      msgPrefix: "[core.registration.connections] ",
      redact: ["context.password", "context.username", "context.token"],
    }
  );
  localLogger.info("Registering connections...");
  const promises = [];

  for (const connectionConfig of connectionConfigs) {
    const connectionTypeInfo = Step.parseType(connectionConfig.type);
    if (connectionNames.includes(connectionTypeInfo.subType)) {
      const Connection = (
        await import(
          normalize(
            `${srcDir}/${connectionTypeInfo.type}s/${connectionTypeInfo.subType}.js`
          )
        )
      ).default;

      const newConnection = new Connection(connectionConfig);

      (globals as Globals).connections.push(newConnection);
      promises.push(newConnection.register());
      localLogger.info("Registered connection.");
    }
  }

  await Promise.all(promises);
  localLogger.info("Connection registration completed.");
}

export function getConnection(connectionKey: string) {
  return (globals as Globals).connections.find(
    (connection) => connection.name === connectionKey
  );
}

export function getConnectionsByType(connectionType: string) {
  return (globals as Globals).connections.filter(
    (connection) => connection.config.type.split(":")[1] === connectionType
  );
}
