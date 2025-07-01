import { Connection, ConnectionConfig } from "../util/generic-connection.js";
import Task from "../util/generic-task.js";

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

  constructor(config: InfluxDBConnectionConfig, task: Task) {
    super(config, task);
  }

  async register() {
    if (!this.config.disabled) {
      return this.enable();
    }
  }

  async enable() {}
}
