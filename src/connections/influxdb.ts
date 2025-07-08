import { Connection, ConnectionConfig } from "../util/generic-connection.js";

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

  async enable() {}
}
