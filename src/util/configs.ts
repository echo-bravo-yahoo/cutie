import { readFile, writeFile } from "node:fs/promises";
import { normalize, parse } from "node:path";

import { read } from "node-yaml";

import { globals } from "../index.js";
import { ConnectionConfig, requireConfigProvider } from "./Connection.js";
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

const CONF_SUFFIX = ".conf";

// `download` writes a file per node and `upload` reads the node name back out
// of it, so the two derivations have to be one function. When they were two,
// "kitchen-pi.conf.json" came back as "kitchen-pi.conf" and a downloaded fleet
// re-uploaded itself one topic segment off from where it came from.
export function nodeNameFromPath(filePath: string): string {
  const base = parse(filePath).name;

  return base.endsWith(CONF_SUFFIX) && base !== CONF_SUFFIX
    ? base.slice(0, -CONF_SUFFIX.length)
    : base;
}

export function configFileNameForNode(nodeName: string): string {
  return `${nodeName}${CONF_SUFFIX}.json`;
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
    // The bootstrap connections have done their job whether or not the fetch
    // worked; drop them before falling back, so the connections the cached
    // config declares are the only ones left.
    await Promise.allSettled(
      globals.connections.map((connection) => connection.disable()),
    );
    globals.connections = [];

    return fetchCachedConfig(cacheFilePath, error);
  }
}

// A YAMLException carries the failing position on `mark`, zero-indexed, which
// nothing else in the message makes obvious.
function describeReadError(error: unknown): string {
  const yaml = error as {
    name?: string;
    reason?: string;
    mark?: { line: number; column: number };
  };

  if (yaml?.name === "YAMLException" && yaml.mark)
    return `${yaml.reason} at line ${yaml.mark.line + 1}, column ${yaml.mark.column + 1}`;

  return `${(error as Error)?.message ?? error}`;
}

async function fetchLocalConfig(path: string): Promise<ConfigFile> {
  const resolved = normalize(path);

  try {
    return await read(resolved);
  } catch (error) {
    throw new Error(
      `Could not read the config at "${resolved}": ${describeReadError(error)}.`,
    );
  }
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

  // Both failures matter here: the reason the fetch failed and the reason the
  // fallback could not cover for it.
  try {
    cached = await readFile(path, { encoding: "utf8" });
  } catch (cacheError) {
    throw new Error(
      `Could not fetch the remote config (${describeReadError(originalError)}), and could not read the cached copy at "${path}" (${describeReadError(cacheError)}).`,
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(cached);
  } catch (parseError) {
    throw new Error(
      `Could not fetch the remote config (${describeReadError(originalError)}), and the cached copy at "${path}" is not valid JSON (${describeReadError(parseError)}).`,
    );
  }

  globals.logger.error(
    `Could not fetch the remote config (${originalError}). FALLING BACK to the cached copy at "${path}", which may be out of date.`,
  );

  return parsed;
}

async function fetchRemoteConfig(config: RemoteConfigFile) {
  const providerConfig = config.configProvider;
  await registerConnections(config.connections);
  const connection = requireConfigProvider(
    getConnection(config.configProvider.connectionName),
  );
  globals.logger.info(
    `Fetching remote config from "${connection.name}" provider (type: ${connection.subKind}).`,
  );
  const newConfigFile = await connection.fetchConfig(
    providerConfig,
    connection.config,
  );
  // the bootstrap connections have done their job; close them before dropping
  // the references, or their sockets stay open for the life of the process
  await Promise.allSettled(
    globals.connections.map((connection) => connection.disable()),
  );
  globals.connections = [];

  return newConfigFile;
}
