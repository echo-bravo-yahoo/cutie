import { readdir } from "node:fs/promises";
import { normalize, parse } from "node:path";

import parser from "yargs-parser";

import { globals, srcDir } from "../index.js";

import { Connection, ConnectionConfig } from "./Connection.js";
import { Configurable } from "./Configurable.js";
import { ParserDefaults } from "./cli.js";
import { redact } from "./redact.js";

export function mergeParserArgs(
  defaults: ParserDefaults,
  overrides: parser.Options,
) {
  const results = defaults;
  if (overrides.string)
    defaults.string = [...defaults.string, ...overrides.string];
  return results;
}

export async function registerConnections(
  connectionConfigs: Array<ConnectionConfig>,
) {
  const topic = "core.registration.connections";
  const connectionNames = (
    await readdir(normalize(`${srcDir}/connections`))
  ).map((name) => parse(name).name);

  globals.logger.emit(
    Configurable.formatLogLine("Registering connections...", { topic }),
    "info",
    topic,
  );
  const promises: Array<Promise<void>> = [];

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
        redact(connectionConfig),
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
    throw new Error(
      `Could not find connection "${connectionName}" in list ${JSON.stringify(globals.connections.map((connection) => connection.name))}.`,
    );

  return connection;
}

export function getConnectionsByType(
  connectionType: string,
): Array<Connection> {
  return globals.connections.filter(
    (connection) => connection.config.type.split(":")[1] === connectionType,
  );
}
