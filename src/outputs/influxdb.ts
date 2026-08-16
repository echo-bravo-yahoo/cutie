import { getConnection } from "../util/connections.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import InfluxDBConnection from "../connections/influxdb.js";
import { Message } from "../util/type-helpers.js";

export interface InfluxDBConfig extends OutputConfig {
  measurement: string;
  tags: Record<string, string>;
  connectionName: string;
}

export function isInfluxDBMessage(
  message: Message,
): message is InfluxDBMessage {
  return (
    typeof message === "object" &&
    typeof (message as unknown as InfluxDBMessage).fields === "object"
  );
}

interface InfluxDBMessage {
  fields: Record<string, Message>;
  tags?: Record<string, string>;
}

// Line protocol: commas, spaces and equals signs are separators and must be
// escaped inside measurement names, tag keys/values and field keys.
function escapeLine(value: string) {
  return value.replace(/([,= ])/g, "\\$1");
}

const PRECISION_DIVISORS: Record<string, number> = {
  s: 1000,
  ms: 1,
};

const PRECISION_MULTIPLIERS: Record<string, number> = {
  us: 1000,
  ns: 1000000,
};

export default class InfluxDB extends Output {
  declare config: InfluxDBConfig;
  // @ts-expect-error config is instantiated by enable
  influxdb: InfluxDBConnection;

  constructor(config: InfluxDBConfig, task: Task) {
    super(config, task);
  }

  async enable() {
    this.influxdb = getConnection(
      this.config.connectionName,
    ) as unknown as InfluxDBConnection;
    this.enabled = true;
  }

  objectToLine(object: Record<string, Message>) {
    const result = [];
    for (const [key, value] of Object.entries(object)) {
      result.push(`${escapeLine(key)}=${escapeLine(String(value))}`);
    }

    return result.join(",");
  }

  // The server is told which precision the timestamp is in, so it has to be
  // written in that precision rather than always in milliseconds.
  timestamp() {
    const precision = this.influxdb.config.precision ?? "ms";
    const milliseconds = Date.now();

    if (PRECISION_DIVISORS[precision])
      return Math.floor(milliseconds / PRECISION_DIVISORS[precision]);
    if (PRECISION_MULTIPLIERS[precision])
      return milliseconds * PRECISION_MULTIPLIERS[precision];

    throw new Error(
      `Unsupported InfluxDB precision "${precision}"; should be one of "ns", "us", "ms", "s".`,
    );
  }

  async sendLine(line: string) {
    const { url, organization, bucket, precision, token } =
      this.influxdb.config;
    const endpoint = new URL(url);
    endpoint.searchParams.set("org", organization);
    endpoint.searchParams.set("bucket", bucket);
    endpoint.searchParams.set("precision", precision);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "text/plain; charset=utf-8",
        Accept: "application/json",
      },
      body: line,
    });

    if (!response.ok)
      throw new Error(
        `InfluxDB write failed (${response.status}): ${await response.text()}`,
      );

    return response;
  }

  // object to turn into a message _or_ a raw string already in message format
  async send(message: Message, _traceId: string) {
    if (typeof message === "string") {
      // TO-DO: validation
      await this.sendLine(message);
      return message;
    } else if (isInfluxDBMessage(message)) {
      const measurementName = this.interpolateConfigString(
        this.config.measurement,
        { message },
      );
      let tagsString = "";

      // Tags supplied on the message get interpolated alongside the configured
      // ones, matching output:mqtt, which interpolates a topic from either
      // source.
      if (message.tags || this.config.tags)
        tagsString = this.objectToLine(
          this.interpolateDeep(
            { ...this.config.tags, ...message.tags },
            { message },
          ) as Record<string, Message>,
        );

      if (tagsString) tagsString = `,${tagsString}`;
      const data = this.objectToLine(message.fields);

      const line = `${escapeLine(measurementName)}${tagsString || ""} ${data} ${this.timestamp()}`;
      await this.sendLine(line);

      return message;
    } else {
      throw new Error(
        `Invalid InfluxDB message format for message: ${JSON.stringify(message)}.`,
      );
    }
  }
}

/*
config format:
{
  "type": "output:influxdb",
  "disabled": false,
  "measurement": string,
  "tags": Record<string, string>,
  "connectionName": string,
}

message format:
{
  tags?: Record<string, string>,
  fields: Record<string, string>, where the value already has any type indicator baked-in (e.g., i)
}
*/
