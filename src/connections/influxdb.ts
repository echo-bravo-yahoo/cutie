import { Connection, ConnectionConfig } from "../util/Connection.js";
import { ProviderConfig } from "../util/type-helpers.js";

export interface InfluxDBConnectionConfig extends ConnectionConfig {
  measurement: string;
  labels: Array<string>;
  url: string;
  organization: string;
  bucket: string;
  token: string;
  precision: number;
}

export default class InfluxDBConnection extends Connection {
  declare config: InfluxDBConnectionConfig;

  constructor(config: InfluxDBConnectionConfig) {
    super(config);
  }

  fetchAllConfigs() {
    throw new Error(`The InfluxDB connection cannot be used to fetch config.`);
  }

  fetchConfig(_provider: ProviderConfig): void {
    throw new Error(`The InfluxDB connection cannot be used to fetch config.`);
  }

  async enable() {}
}
