import { globals } from "../index.js";
import { getConnection } from "../util/connections.js";
import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import MQTTConnection from "../connections/mqtt.js";
import { toTraceparent } from "../util/trace.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface MQTTConfig extends OutputConfig {
  topics: Array<string>;
  connectionName: string;
  propagateTrace?: boolean;
  retain?: boolean;
  qos?: 0 | 1 | 2;
  raw?: boolean;
}

export default class MQTT extends Output {
  declare config: MQTTConfig;
  mqtt?: MQTTConnection;
  warnedAboutProtocolVersion = false;

  constructor(config: MQTTConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async enable() {
    this.mqtt = getConnection(this.config.connectionName) as MQTTConnection;
    this.enabled = true;
  }

  async disable() {
    this.mqtt = undefined;
    this.enabled = false;
  }

  // The trace half of the publish options; send() adds retain and qos around
  // it. User properties are an MQTT v5 feature, and mqtt.js speaks v4 unless
  // the connection asks for v5, so a v4 connection can only be warned about.
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
    // `raw` publishes a string as the payload itself; without it a string is
    // JSON-encoded and arrives at the subscriber wrapped in quotes.
    const payload =
      this.config.raw && typeof message === "string"
        ? message
        : JSON.stringify(message);
    const options = {
      retain: this.config.retain,
      qos: this.config.qos,
      ...this.publishOptions(traceId),
    };

    await Promise.all(
      this.config.topics.map((topic) =>
        this.mqtt?.sendRaw(
          this.interpolateConfigString(topic, { message }),
          payload,
          options,
        ),
      ),
    );

    return message;
  }
}

export const schema: ModuleSchema = {
  type: "output:mqtt",
  description: "Publishes each message to one or more MQTT topics.",
  options: {
    connectionName: {
      type: "string",
      description: "Which declared connection to publish on.",
      required: true,
    },
    topics: {
      type: "array",
      description: "The topics to publish to.",
      required: true,
      interpolated: true,
    },
    retain: {
      type: "boolean",
      description:
        "Ask the broker to keep the message and hand it to future subscribers.",
      default: false,
    },
    qos: {
      // A number rather than a string enum: OptionSchema's `enum` describes
      // string values, and quality of service is a number on the wire.
      type: "number",
      description:
        "MQTT quality of service: 0 at most once, 1 at least once, 2 exactly once.",
      default: 0,
      min: 0,
      max: 2,
      integer: true,
    },
    raw: {
      type: "boolean",
      description:
        "Publish a string message as the payload itself rather than JSON-encoding it. A message that is not a string is encoded either way.",
      default: false,
    },
    propagateTrace: {
      type: "boolean",
      description:
        'Send the trace id as a W3C traceparent user property, which also needs "protocolVersion": 5 on the connection. The payload is untouched.',
      default: false,
    },
  },
};
