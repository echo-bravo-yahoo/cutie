import { Config, Configurable } from "./Configurable.js";
import { Kind } from "./type-helpers.js";

export interface TypedConfig extends Config {
  // the whole "kind:subKind" string; the halves live on the instance as
  // `kind` and `subKind`
  type: string;
  name?: string;
}

export class TypedConfigurable extends Configurable {
  declare kind: Kind | "unknown";
  subKind: string;

  constructor(config: TypedConfig) {
    super(config, config.name || "unknown");

    if (config.type && config.type.includes(":")) {
      const typeInfo = Configurable.parseType(config.type);
      this.kind = typeInfo.kind;
      this.subKind = typeInfo.subKind;
    } else {
      this.kind = "unknown";
      this.subKind = "unknown";
    }
  }
}
