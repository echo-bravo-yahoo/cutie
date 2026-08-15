import { readFile, writeFile } from "node:fs/promises";
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

// The last good remote config, kept beside the local one so a node whose
// broker is down still starts with the config it ran on last time.
export function cachePath(localConfigPath: string) {
  return normalize(`${localConfigPath}.cache.json`);
}

export async function fetchConfig(path: string): Promise<ConfigFile> {
  const localConfig = await fetchLocalConfig(path);
  if (!localConfig.configProvider) return localConfig;

  const cacheFilePath = cachePath(normalize(path));

  try {
    const remoteConfig = await fetchRemoteConfig(
      localConfig as RemoteConfigFile,
    );
    await writeCachedConfig(cacheFilePath, remoteConfig);
    return remoteConfig;
  } catch (error) {
    return fetchCachedConfig(cacheFilePath, error);
  }
}

async function fetchLocalConfig(path: string): Promise<ConfigFile> {
  return read(normalize(path));
}

async function writeCachedConfig(path: string, config: ConfigFile) {
  try {
    await writeFile(path, JSON.stringify(config, null, 4), {
      encoding: "utf8",
    });
  } catch (error) {
    // A node that cannot write its cache should still run on the config it
    // just fetched, so this is a warning rather than a failure.
    globals.logger.warn(
      `Could not write remote config cache to "${path}": ${error}.`,
    );
  }
}

async function fetchCachedConfig(
  path: string,
  originalError: unknown,
): Promise<ConfigFile> {
  let cached;

  try {
    cached = await readFile(path, { encoding: "utf8" });
  } catch {
    throw originalError;
  }

  globals.logger.error(
    `Could not fetch the remote config (${originalError}). FALLING BACK to the cached copy at "${path}", which may be out of date.`,
  );

  return JSON.parse(cached);
}

async function fetchRemoteConfig(config: RemoteConfigFile) {
  const providerConfig = config.configProvider;
  await registerConnections(config.connections);
  const connection = getConnection(config.configProvider.connectionName);
  globals.logger.info(
    `Fetching remote config from "${connection.name}" provider (type: ${connection.subKind}).`,
  );
  const newConfigFile = await connection.fetchConfig(
    providerConfig,
    connection.config,
  );
  globals.connections = [];
  return newConfigFile;
}
