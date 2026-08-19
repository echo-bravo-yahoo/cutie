import { ConfigFile } from "./configs.js";
import { ProviderConfig } from "./type-helpers.js";
import { Module, ModuleConfig } from "./Module.js";

export interface ConnectionConfig extends ModuleConfig {
  disabled?: boolean;
  name: string;
}

// Serving a fleet's configs is a job one connection kind happens to do, not
// something holding a link implies: only connection:mqtt can do it, and
// connection:influxdb used to carry four stubs that existed to throw.
export interface ConfigProvider {
  fetchConfig(
    provider: ProviderConfig,
    connection: ConnectionConfig,
  ): Promise<ConfigFile>;
  // `topic` overrides the connection's default config location; see
  // MQTTConnection for how a "+" segment stands in for the node name.
  fetchSingleConfig(nodeName: string, topic?: string): Promise<ConfigFile>;
  fetchAllConfigs(topic?: string): Promise<Record<string, ConfigFile>>;
  uploadSingleConfig(
    nodeName: string,
    config: ConfigFile,
    topic?: string, //eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any>;
}

export type ProvidingConnection = Connection & ConfigProvider;

export function isConfigProvider(
  connection: Connection,
): connection is ProvidingConnection {
  return (
    typeof (connection as Connection & Partial<ConfigProvider>).fetchConfig ===
    "function"
  );
}

// Naming the connection beats letting the first fetchConfig call fail on a
// connection that never had one.
export function requireConfigProvider(
  connection: Connection,
): ProvidingConnection {
  if (!isConfigProvider(connection))
    throw new Error(
      `Connection "${connection.name}" is a "${connection.config.type}", which cannot serve a config; only connection:mqtt can.`,
    );

  return connection;
}

export abstract class Connection extends Module {
  declare config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    super(config);

    this.logPrefix = `core.runtime.connections.${config.name}`;
  }
}
