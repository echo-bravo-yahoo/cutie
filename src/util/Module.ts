import { Config, Configurable } from "./Configurable.js";
import { Kind } from "./type-helpers.js";

export interface ModuleConfig extends Config {
  // the whole "kind:subKind" string; the halves live on the instance as
  // `kind` and `subKind`
  type: string;
  name?: string;
}

// One of the files under the five module directories: anything a config names
// with a `type`, and so anything with a schema behind it.
export class Module extends Configurable {
  declare kind: Kind | "unknown";
  subKind: string;

  constructor(config: ModuleConfig) {
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
