import { Connection, ConnectionConfig } from "../util/Connection.js";
import { ModuleSchema } from "../util/schema.js";

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

  async enable() {
    // No socket to open -- the output posts over HTTP per message.
    this.enabled = true;
  }
}

export const schema: ModuleSchema = {
  type: "connection:influxdb",
  description:
    "A connection to an InfluxDB write endpoint. It cannot serve a remote config; only MQTT can.",
  options: {
    url: {
      type: "string",
      description:
        'The write endpoint, such as "http://127.0.0.1:8086/api/v2/write".',
      required: true,
    },
    organization: {
      type: "string",
      description: "The InfluxDB organization to write into.",
      required: true,
    },
    bucket: {
      type: "string",
      description: "The bucket to write into.",
      required: true,
    },
    token: {
      type: "string",
      description: "An API token with write permission on the bucket.",
      required: true,
    },
    precision: {
      type: "string",
      description: "The timestamp precision the written lines carry.",
      default: "ms",
      enum: ["ns", "us", "ms", "s"],
    },
  },
};
