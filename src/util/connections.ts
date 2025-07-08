import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals, srcDir } from "../index.js";

import { Connection, ConnectionConfig } from "./generic-connection.js";
import { Configurable } from "./generic-configurable.js";

export async function registerConnections(
  connectionConfigs: Array<ConnectionConfig>
) {
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
    const connectionTypeInfo = Configurable.parseType(connectionConfig.type);
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

export function getConnection(connectionName: string) {
  const connection = globals.connections.find(
    (connection) => connection.name === connectionName
  );

  if (connection === undefined)
    throw new Error(`Could not find connection "${connectionName}".`);

  return connection;
}

export function getConnectionsByType(
  connectionType: string
): Array<Connection> {
  return globals.connections.filter(
    (connection) => connection.config.type.split(":")[1] === connectionType
  );
}
