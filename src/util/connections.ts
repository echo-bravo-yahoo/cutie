import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals, srcDir } from "../index.js";

import { Connection, ConnectionConfig } from "./Connection.js";
import { Configurable } from "./Configurable.js";

function determineRuntimeExtension() {
  const extension = process.argv
    .find((string) => string.endsWith(".ts") || string.endsWith(".js"))
    ?.slice(-3);
  return extension;
}

export async function registerConnections(
  connectionConfigs: Array<ConnectionConfig>,
) {
  const topic = "core.registration.connections";
  const connectionNames = (
    await readdir(normalize(`${srcDir}/connections`))
  ).map((name) => basename(name, determineRuntimeExtension()));

  // TODO: add redaction back in...
  // const localLogger = globals.logger.logger.child(
  //   {},
  //   {
  //     msgPrefix: "[core.registration.connections] ",
  //     redact: ["context.password", "context.username", "context.token"],
  //   }
  // );
  globals.logger.emit(
    Configurable.formatLogLine("Registering connections...", { topic }),
    "info",
    topic,
  );
  const promises = [];

  for (const connectionConfig of connectionConfigs) {
    const connectionTypeInfo = Configurable.parseType(connectionConfig.type);
    if (connectionNames.includes(connectionTypeInfo.subType)) {
      const Connection = (
        await import(
          normalize(
            `${srcDir}/${connectionTypeInfo.type}s/${connectionTypeInfo.subType}.js`,
          )
        )
      ).default;

      const newConnection = new Connection(connectionConfig);

      globals.connections.push(newConnection);
      promises.push(newConnection.register());
      globals.logger.emit(
        Configurable.formatLogLine("Registered connection.", { topic }),
        "info",
        topic,
        connectionConfig,
      );
    }
  }

  await Promise.all(promises);
  globals.logger.emit(
    Configurable.formatLogLine("Connection registration completed.", { topic }),
    "info",
    topic,
  );
}

export function getConnection(connectionName: string) {
  const connection = globals.connections.find(
    (connection) => connection.name === connectionName,
  );

  if (connection === undefined)
    throw new Error(`Could not find connection "${connectionName}".`);

  return connection;
}

export function getConnectionsByType(
  connectionType: string,
): Array<Connection> {
  return globals.connections.filter(
    (connection) => connection.config.type.split(":")[1] === connectionType,
  );
}
