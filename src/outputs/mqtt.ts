import { globals } from "../index.js";
import { getConnection } from "../util/connections.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import MQTTConnection from "../connections/mqtt.js";
import { toTraceparent } from "../util/trace.js";
import { Message } from "../util/type-helpers.js";

export interface MQTTConfig extends OutputConfig {
  topics?: Array<string>;
  topic?: string;
  connectionName: string;
  propagateTrace?: boolean;
}

export default class MQTT extends Output {
  declare config: MQTTConfig;
  mqtt?: MQTTConnection;
  warnedAboutProtocolVersion = false;

  constructor(config: MQTTConfig, task: Task) {
    super(config, task);
  }

  async enable() {
    this.mqtt = getConnection(this.config.connectionName) as MQTTConnection;
    this.enabled = true;
  }

  async disable() {
    this.mqtt = undefined;
    this.enabled = false;
  }

  // Singular `topic` and plural `topics` are both accepted, matching what
  // trigger:mqtt already tolerates. Before this the output took only `topics`
  // and threw `Cannot read properties of undefined (reading 'forEach')` on the
  // singular form - including on the form its own example below documented.
  get topics(): Array<string> {
    if (this.config.topics?.length) return this.config.topics;
    if (this.config.topic) return [this.config.topic];
    throw new Error(
      `output:mqtt at ${this.logPrefix} needs a "topic" or a non-empty "topics".`,
    );
  }

  // User properties are an MQTT v5 feature, and mqtt.js speaks v4 unless the
  // connection asks for v5, so a v4 connection can only be warned about.
  publishOptions(traceId: string) {
    if (!this.config.propagateTrace) return undefined;

    // the connection may have been closed out from under this output, which
    // leaves the client undefined rather than the connection missing
    if (this.mqtt?.connection?.options.protocolVersion !== 5) {
      if (!this.warnedAboutProtocolVersion) {
        this.warnedAboutProtocolVersion = true;
        globals.logger.warn(
          `Not propagating trace IDs over MQTT connection "${this.config.connectionName}"; a traceparent user property needs "protocolVersion": 5 on the connection.`,
        );
      }

      return undefined;
    }

    return {
      properties: { userProperties: { traceparent: toTraceparent(traceId) } },
    };
  }

  async send(message: Message, traceId: string) {
    const options = this.publishOptions(traceId);

    await Promise.all(
      this.topics.map((topic) =>
        this.mqtt?.sendRaw(
          this.interpolateConfigString(topic, { message }),
          JSON.stringify(message),
          options,
        ),
      ),
    );

    return message;
  }
}

/*
{
  "type": "output:mqtt",
  "disabled": false,
  "connectionName": "personal-mqtt",
  "topics": ["data/weather/${stash.location}"],
  // sends the trace as a W3C traceparent user property, which also needs
  // "protocolVersion": 5 on the connection; the payload is untouched
  "propagateTrace": false
}

`"topic": "data/weather/bedroom"` is accepted as a single-topic shorthand.
*/
