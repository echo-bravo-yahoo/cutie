import {
  TypedConfig,
  TypedConfigurable,
} from "./generic-typed-configurable.js";

export interface ConnectionConfig extends TypedConfig {
  disabled: boolean;
  name: string;
}

export class Connection extends TypedConfigurable {
  config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    super(config);
  }
}
