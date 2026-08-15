import { ConfigFile } from "../util/configs.js";
import { Connection, ConnectionConfig } from "../util/Connection.js";
import { ProviderConfig } from "../util/type-helpers.js";

export interface InfluxDBConnectionConfig extends ConnectionConfig {
  url: string;
  organization: string;
  bucket: string;
  token: string;
  precision: "ns" | "us" | "ms" | "s";
}

export default class InfluxDBConnection extends Connection {
  declare config: InfluxDBConnectionConfig;

  constructor(config: InfluxDBConnectionConfig) {
    super(config);
  }

  fetchSingleConfig(_nodeName: string): Promise<ConfigFile> {
    throw new Error(`The InfluxDB connection cannot be used to fetch config.`);
  }

  fetchAllConfigs() {
    throw new Error(`The InfluxDB connection cannot be used to fetch config.`);
  }

  // @ts-expect-error should throw on call
  fetchConfig(_provider: ProviderConfig): void {
    throw new Error(`The InfluxDB connection cannot be used to fetch config.`);
  }

  // @ts-expect-error should throw on call
  uploadSingleConfig(_nodeName: string, _config: ConfigFile) {
    throw new Error(`The InfluxDB connection cannot be used to fetch config.`);
  }

  async enable() {
    // No socket to open -- the output posts over HTTP per message.
    this.enabled = true;
  }
}

/*
{
  "type": "connection:influxdb",
  "name": "personal-influxdb",
  "url": "http://127.0.0.1:8086/api/v2/write",
  "organization": "home",
  "bucket": "sensors",
  "token": "",
  "precision": "ns" | "us" | "ms" | "s"
}
*/
