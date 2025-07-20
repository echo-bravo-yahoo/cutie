import { exec } from "node:child_process";

import { getConnection } from "../util/connections.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import InfluxDBConnection from "../connections/influxdb.js";
import { Message } from "../util/type-helpers.js";

export interface InfluxDBConfig extends OutputConfig {
  measurement: string;
  labels: Array<string>;
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
    this.influxdb = getConnection(this.name) as unknown as InfluxDBConnection;
    this.enabled = true;
  }

  objectToLine(object: Record<string, Message> | InfluxDBMessage) {
    const result = [];
    delete object.labels;
    for (const [key, value] of Object.entries(object)) {
      result.push(`${key}=${value}`);
    }

    return result.join(",");
  }

  // raw or { event, labels } object
  async send(message: Message) {
    if (!isInfluxDBMessage(message))
      throw new Error(
        `Invalid message shape for influxdb message ${JSON.stringify(message)}`,
      );
    if (typeof message !== "object") return message;

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
    const { url, organization, bucket, precision, token } =
      this.influxdb.config;
    const command = `curl --request POST \
--header "Authorization: Token ${token}" \
--header "Content-Type: text/plain; charset=utf-8" \
--header "Accept: application/json" \
--data-binary "${line}" \
"${url}?org=${organization}&bucket=${bucket}&precision=${precision}"`;
    // console.log(`Running command: ${command}`);
    exec(command, (_error, stdout, _stderr) => {
      console.log(`Result: ${stdout}`);
    });

    return line;
  }
}

/*
{
  "type": "output:mqtt:personal-mqtt",
  "disabled": false,
  "topic": "data/weather/${state.location}"
}
*/
