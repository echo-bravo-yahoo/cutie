import { normalize } from "node:path";

import { read } from "node-yaml";

import { globals } from "../index.js";
import { ConnectionConfig } from "./Connection.js";
import { getConnection, registerConnections } from "./connections.js";
import { TaskConfig } from "./Task.js";
import { ProviderConfig } from "./type-helpers.js";

export interface ConfigFile {
  configProvider: ProviderConfig;
  connections: Array<ConnectionConfig>;
  tasks?: Array<TaskConfig>;
}

export async function fetchLocalConfig(path: string) {
  return read(normalize(path));
}

export async function fetchRemoteConfig(config: ConfigFile) {
  const providerConfig = config.configProvider;
  await registerConnections(config.connections);
  const connection = getConnection(config.configProvider.connectionName);
  globals.logger.info(
    `Fetching remote config from "${connection.name}" provider (type: ${connection.subType}).`,
  );
  const newConfigFile = await connection.fetchConfig(
    providerConfig,
    connection.config,
  );
  globals.connections = [];
  return newConfigFile;
}
