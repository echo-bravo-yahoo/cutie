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
  labels: Record<string, string>;
  connectionName: string;
}

export function isInfluxDBMessage(
  message: Message,
): message is InfluxDBMessage {
  return (
    typeof message === "object" &&
    typeof (message as unknown as InfluxDBMessage).data === "string"
  );
}

interface InfluxDBMessage {
  data: string;
  labels?: Array<string>;
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
    delete object.labels;
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
      await this.sendLine(message);
      return message;
    } else if (typeof message === "object") {
      const measurementName = this.config.measurement;
      let labelsString = "";

      // TO-DO: do interpolation here
      if (message.labels || this.config.labels)
        labelsString = this.objectToLine({
          ...this.config.labels,
          ...message.labels,
        });

      if (labelsString) labelsString = `,${labelsString}`;
      const data = this.objectToLine(message);

      const line = `${measurementName}${labelsString || ""} ${data} ${new Date().valueOf()}`;
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
  "type": "output:mqtt:personal-mqtt",
  "disabled": false,
  "measurement": string,
  "topic": "data/weather/${state.location}"
}

message format:
{
  labels?: Record<string, string>,
  [key: value] where the value already has any type indicator baked-in (e.g., i)
}
*/
