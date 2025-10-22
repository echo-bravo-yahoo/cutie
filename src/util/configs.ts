import { normalize } from "node:path";

import { read } from "node-yaml";

import { globals } from "../index.js";
import { ConnectionConfig } from "./Connection.js";
import { getConnection, registerConnections } from "./connections.js";
import { TaskConfig } from "./Task.js";
import { ProviderConfig } from "./type-helpers.js";

export interface ConfigFile {
  configProvider?: ProviderConfig;
  connections: Array<ConnectionConfig>;
  tasks?: Array<TaskConfig>;
}

export interface RemoteConfigFile extends ConfigFile {
  configProvider: ProviderConfig;
}

export async function fetchConfig(path: string): Promise<ConfigFile> {
  const localConfig = await fetchLocalConfig(path);
  // TODO: write backup of config to file for later
  return localConfig.configProvider
    ? await fetchRemoteConfig(localConfig as RemoteConfigFile)
    : localConfig;
}

async function fetchLocalConfig(path: string): Promise<ConfigFile> {
  return read(normalize(path));
}

async function fetchRemoteConfig(config: RemoteConfigFile) {
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
