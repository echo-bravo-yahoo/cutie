import { ConfigFile } from "./configs.js";
import { ProviderConfig } from "./type-helpers.js";
import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";

export interface ConnectionConfig extends TypedConfig {
  disabled?: boolean;
  name: string;
}

export abstract class Connection extends TypedConfigurable {
  declare config: ConnectionConfig;
  abstract fetchConfig(
    provider: ProviderConfig,
    connection: ConnectionConfig,
  ): Promise<ConfigFile>;
  // `topic` overrides the connection's default config location; see
  // MQTTConnection for how a "+" segment stands in for the node name.
  abstract fetchSingleConfig(
    nodeName: string,
    topic?: string,
  ): Promise<ConfigFile> | void;
  abstract fetchAllConfigs(
    topic?: string,
  ): Promise<Record<string, ConfigFile>> | void;
  abstract uploadSingleConfig(
    nodeName: string,
    config: ConfigFile,
    topic?: string, //eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any>;

  constructor(config: ConnectionConfig) {
    super(config);
  }
}
