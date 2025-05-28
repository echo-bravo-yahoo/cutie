import { Connection } from "../util/generic-connection.js";

export default class InfluxDB extends Connection {
  constructor(config, task) {
    super(config, task);
  }
}
