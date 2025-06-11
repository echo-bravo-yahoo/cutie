import { exec } from "node:child_process";

import { getConnection } from "../util/connections.js";
import Output from "../util/generic-output.js";

export default class InfluxDB extends Output {
  constructor(config, task) {
    super(config, task);
  }

  async register() {
    if (!this.config.disabled && !this.task.disabled) {
      return this.enable();
    }
  }

  async enable() {
    this.influxdb = getConnection(this.name);
    this.enabled = true;
  }

  async disable() {
    this.enabled = false;
  }

  objectToLine(object) {
    const result = [];
    delete object.labels;
    for (const [key, value] of Object.entries(object)) {
      result.push(`${key}=${value}`);
    }

    return result.join(",");
  }

  // raw or { event, labels } object
  async send(message) {
    // console.log("message:", message);

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

    let line = `${measurementName}${labelsString || ""} ${data} ${new Date().valueOf()}`;
    const { url, organization, bucket, precision, token } =
      this.influxdb.config;
    let command = `curl --request POST \
--header "Authorization: Token ${token}" \
--header "Content-Type: text/plain; charset=utf-8" \
--header "Accept: application/json" \
--data-binary "${line}" \
"${url}?org=${organization}&bucket=${bucket}&precision=${precision}"`;
    // console.log(`Running command: ${command}`);
    exec(command, (_error, stdout, _stderr) => {
      console.log(`Result: ${stdout}`);
    });
  }
}

/*
{
  "type": "output:mqtt:personal-mqtt",
  "disabled": false,
  "topic": "data/weather/${state.location}"
}
*/
