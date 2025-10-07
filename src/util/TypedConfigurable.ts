import {
  Config,
  Configurable,
  ConfigurableImplementation,
} from "./Configurable.js";

export interface TypedConfig extends Config {
  type: string;
  name?: string;
}

export class TypedConfigurable extends Configurable {
  type: string;
  subType: string;

  constructor(
    config: TypedConfig,
    implementation?: ConfigurableImplementation,
  ) {
    super(config, config.name || "unknown", implementation);

    if (config.type && config.type.includes(":")) {
      const typeInfo = Configurable.parseType(config.type);
      this.type = typeInfo.type;
      this.subType = typeInfo.subType;
    } else {
      this.type = "unknown";
      this.subType = "unknown";
    }
  }
}
