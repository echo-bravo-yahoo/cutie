import { promisify } from "node:util";
import child_process from "node:child_process";
const exec = promisify(child_process.exec);

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
  tags?: Array<string>;
}

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
      result.push(`${key}=${value}`);
    }

    return result.join(",");
  }

  async sendLine(line: string) {
    const { url, organization, bucket, precision, token } =
      this.influxdb.config;
    const command = `curl --request POST \
--header "Authorization: Token ${token}" \
--header "Content-Type: text/plain; charset=utf-8" \
--header "Accept: application/json" \
--data-binary "${line}" \
"${url}?org=${organization}&bucket=${bucket}&precision=${precision}"`;
    // console.log(`Running command: ${command}`);
    return exec(command);
  }

  // object to turn into a message _or_ a raw string already in message format
  async send(message: Message) {
    if (typeof message === "string") {
      // TO-DO: validation
      await this.sendLine(message);
      return message;
    } else if (isInfluxDBMessage(message)) {
      const measurementName = this.config.measurement;
      let tagsString = "";

      // TO-DO: do interpolation here
      if (message.tags || this.config.tags)
        tagsString = this.objectToLine({
          ...this.config.tags,
          ...message.tags,
        });

      if (tagsString) tagsString = `,${tagsString}`;
      const data = this.objectToLine(message.fields);

      const line = `${measurementName}${tagsString || ""} ${data} ${new Date().valueOf()}`;
      await this.sendLine(line);

      return message;
    } else {
      throw new Error(`Invalid InfluxDB message format.`);
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
