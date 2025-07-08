import { Config, Configurable } from "./generic-configurable.js";

export interface TypedConfig extends Config {
  type: string;
  name?: string;
}

export class TypedConfigurable extends Configurable {
  type: string;
  subType: string;

  constructor(config: TypedConfig) {
    super(config, config.name || "unknown");

    if (config.type && config.type.includes(":")) {
      const typeInfo = Configurable.parseType(config.type);
      this.type = typeInfo.type;
      this.subType = typeInfo.subType;
    }
  }
}
