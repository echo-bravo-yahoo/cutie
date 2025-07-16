import { TypedConfig, TypedConfigurable } from "./TypedConfigurable.js";

export interface ConnectionConfig extends TypedConfig {
  disabled: boolean;
  name: string;
}

export class Connection extends TypedConfigurable {
  declare config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    super(config);
  }
}
