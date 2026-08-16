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
    if (connectionNames.includes(connectionTypeInfo.subKind)) {
      const Connection = (
        await import(
          normalize(
            `${srcDir}/${connectionTypeInfo.kind}s/${connectionTypeInfo.subKind}.js`,
          )
        )
      ).default;

      const newConnection = new Connection(connectionConfig);

      globals.connections.push(newConnection);
      promises.push(
        // A single unreachable broker must not stop other connections or any
        // task from registering. mqtt.js has already torn the client down by
        // the time this rejects, so the connection stays inert until cutie
        // restarts (systemd's Restart=always covers that in production).
        newConnection.register().catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : error;
          const message = `Failed to register connection "${connectionConfig.name}": ${reason}`;

          // Connections register before tasks, so no trigger:logs task can be
          // listening yet -- emit() alone is a silent no-op here. Write directly
          // to pino too, the same way configs.ts and mqtt.ts's fetchConfig()
          // already do for other failures that happen before task registration.
          globals.logger.error(message, {
            topic,
            connection: redact(connectionConfig),
          });
          globals.logger.emit(
            Configurable.formatLogLine(message, { topic }),
            "error",
            topic,
          );
        }),
      );
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
