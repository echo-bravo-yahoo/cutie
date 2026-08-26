import parser from "yargs-parser";

import MQTTConnection from "../connections/mqtt.js";
import { globals, initializeGlobals } from "../index.js";
import {
  ProvidingConnection,
  requireConfigProvider,
} from "../util/Connection.js";
import { CLIArgs, mergeParserArgs, parserDefaults } from "../util/cli.js";
import { getConnection, registerConnections } from "../util/connections.js";
import { fetchConfig } from "../util/configs.js";
import { startServer } from "../web/server.js";

export interface ServeUIArgs extends Omit<CLIArgs, "_"> {
  connectionName: string;
  topic?: string;
  port?: number;
  host?: string;
}

export function parseServeUIArgs(args: Array<string> = process.argv.slice(2)) {
  const serveUIParserArgs = {
    string: ["connectionName", "topic", "host"],
  };

  return parser(args, {
    ...mergeParserArgs(parserDefaults, serveUIParserArgs),
    number: ["port"],
  }) as unknown as ServeUIArgs;
}

// Only connection:mqtt implements ConfigProvider today, and the live-message
// firehose this mode also serves needs that class's own raw mqtt.MqttClient,
// not just the generic ConfigProvider contract requireConfigProvider checks.
function requireMQTTConnection(
  connection: ProvidingConnection,
): MQTTConnection {
  if (!(connection instanceof MQTTConnection))
    throw new Error(
      `Connection "${connection.name}" is a "${connection.config.type}", which the web UI cannot serve live messages from; only connection:mqtt can.`,
    );

  return connection;
}

export default async function serveUI(args: ServeUIArgs) {
  initializeGlobals(args.logLevel, args.config);
  const config = await fetchConfig(args.config);
  // No registerTasks here, matching upload/download: serving the UI must not
  // start live triggers.
  await registerConnections(config.connections);
  // No tasks means no trigger:logs task will ever turn up, so the window for
  // holding lines is already over.
  globals.logger.stopBuffering();

  const connection = requireMQTTConnection(
    requireConfigProvider(getConnection(args.connectionName)),
  );

  const httpServer = await startServer({
    connection,
    topic: args.topic,
    port: args.port ?? 4200,
    host: args.host ?? "127.0.0.1",
  });

  // There are no tasks to tear down in this mode, so lifecycle.ts's
  // task-oriented shutdown does not apply; closing the HTTP server and the
  // one connection this mode opened is the whole teardown.
  const shutdown = async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await connection.disable();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
