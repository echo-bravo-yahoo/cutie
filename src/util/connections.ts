import { normalize } from "node:path";

import { globals, srcDir } from "../index.js";

import { ConnectionConfig } from "./Connection.js";
import { Configurable } from "./Configurable.js";
import { logAt } from "./LogHelper.js";
import { listModules } from "./modules.js";
import { redact } from "./redact.js";

export async function registerConnections(
  connectionConfigs: Array<ConnectionConfig>,
) {
  const topic = "core.registration.connections";
  const connectionNames = (await listModules()).connection;

  logAt(topic, "info", "Registering connections...");
  const promises: Array<Promise<void>> = [];

  for (const connectionConfig of connectionConfigs) {
    const { kind, subKind } = Configurable.parseType(connectionConfig.type);

    if (!connectionNames.includes(subKind))
      throw new Error(
        `Unknown connection type "${connectionConfig.type}"; expected one of: ${connectionNames.join(", ")}.`,
      );

    const Connection = (
      await import(normalize(`${srcDir}/${kind}s/${subKind}.js`))
    ).default;

    const newConnection = new Connection(connectionConfig);

    // Kept in the list even when disabled, so a step that names it can be
    // told it is disabled rather than that it does not exist.
    globals.connections.push(newConnection);

    if (!newConnection.shouldEnable()) {
      logAt(
        topic,
        "info",
        "Skipped a disabled connection.",
        redact(connectionConfig),
      );
      continue;
    }

    promises.push(
      // A single connection that fails to register must not stop other
      // connections or any task from registering. It stays inert until cutie
      // restarts. An MQTT broker that is merely unreachable does not land
      // here: register() leaves the client retrying instead of rejecting.
      newConnection
        .register()
        .then(() => newConnection.enable())
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : error;

          logAt(
            topic,
            "error",
            `Failed to register connection "${connectionConfig.name}": ${reason}`,
            { connection: redact(connectionConfig) },
          );
        }),
    );
    logAt(topic, "info", "Registered connection.", redact(connectionConfig));
  }

  await Promise.all(promises);
  logAt(topic, "info", "Connection registration completed.");
}

export function getConnection(connectionName: string) {
  const connection = globals.connections.find(
    (connection) => connection.name === connectionName,
  );

  if (connection === undefined)
    throw new Error(
      `Could not find connection "${connectionName}" in list ${JSON.stringify(globals.connections.map((connection) => connection.name))}.`,
    );

  // A disabled connection is present but has no socket, so saying so beats
  // handing back something whose client is undefined.
  if (!connection.shouldEnable())
    throw new Error(
      `Connection "${connectionName}" is declared but disabled, so no step can use it.`,
    );

  return connection;
}
