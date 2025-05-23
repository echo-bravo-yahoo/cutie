import { exec } from "node:child_process";

import { Connection } from "../util/generic-connection.js";

export default class InfluxDB extends Connection {
  constructor(config) {
    super(config);
  }

  async register() {
    // this.enable();
  }

  async send(measurementName, event, labels) {
    let data = [],
      labelsArray = [],
      labelsString = "";

    for (const [key, value] of Object.entries(event)) {
      if (key !== "metadata" && key !== "aggregationMetadata") {
        data.push(`${key}=${value}`);
      }
    }

    for (const [labelKey, labelValue] of Object.entries(labels)) {
      labelsArray.push(`${labelKey}=${labelValue}`);
    }

    labelsString = labelsArray.join(",");
    if (labelsString.length) labelsString = `,${labelsString}`;
    data = data.join(",");

    let line = `${measurementName}${labelsString} ${data} ${new Date().valueOf()}`;
    const { url, organization, bucket, precision, token } = this.moduleState;
    let command = `curl --request POST \
--header "Authorization: Token ${token}" \
--header "Content-Type: text/plain; charset=utf-8" \
--header "Accept: application/json" \
--data-binary "${line}" \
"${url}?org=${organization}&bucket=${bucket}&precision=${precision}"`;
    console.log(`Running command: ${command}`);
    const result = exec(command);
    console.log(`Result: ${result}`);
  }
}

/*
{
  "metadata": {
    "island": "skeppsholmen",
    "timestamp": "2024-11-19T04:59:43.405Z"
  },
  "temp": 76.52394317895174,
  "humidity": 28.606149841897132,
  "pressure": 1003.3289466281659
  "dimensions": {
    "island": "skeppsholmen",
    "location": "office"
  }
}
*/
