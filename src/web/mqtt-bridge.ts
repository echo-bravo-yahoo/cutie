import MQTTConnection from "../connections/mqtt.js";
import { ProvidingConnection } from "../util/Connection.js";
import { ConfigFile } from "../util/configs.js";
import { ConfigError, validateConfig } from "../util/validate.js";

// A longer window than fetchAllConfigs' own 100ms default: that default suits
// a CLI one-shot where under-collecting just means a slower second run, but
// here a slow-to-respond node silently missing from the list looks like it
// does not exist.
const DISCOVER_WAIT_MS = 1500;

export function discoverNodes(
  connection: ProvidingConnection,
  topic?: string,
): Promise<Record<string, ConfigFile>> {
  return connection.fetchAllConfigs(topic, DISCOVER_WAIT_MS);
}

export interface PublishResult {
  ok: boolean;
  errors?: Array<ConfigError>;
  warnings?: Array<ConfigError>;
}

export async function publishNode(
  connection: ProvidingConnection,
  name: string,
  config: ConfigFile,
  topic?: string,
): Promise<PublishResult> {
  const problems = await validateConfig(config, { configPath: name });
  const errors = problems.filter((problem) => problem.severity === "error");

  if (errors.length) return { ok: false, errors };

  await connection.uploadSingleConfig(name, config, topic);

  const warnings = problems.filter((problem) => problem.severity === "warning");
  return { ok: true, warnings };
}

export interface LiveMessage {
  topic: string;
  payload: unknown;
  timestamp: number;
}

// Not every publisher on the broker sends JSON, so a payload that fails to
// parse is handed to the browser as the raw string rather than dropped.
function parseOrRaw(payload: Buffer): unknown {
  const text = payload.toString();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Subscribes to the whole broker once, at server startup -- not per
// WebSocket client -- and hands every message to onMessage, which fans it out.
// This needs the raw mqtt.MqttClient underneath connection:mqtt, which is
// outside the generic ConfigProvider contract, so it takes the concrete class
// rather than the ProvidingConnection interface the other functions here use.
export async function startLiveFeed(
  connection: MQTTConnection,
  onMessage: (message: LiveMessage) => void,
): Promise<void> {
  connection.connection.on("message", (topic: string, payload: Buffer) => {
    onMessage({ topic, payload: parseOrRaw(payload), timestamp: Date.now() });
  });

  await connection.connection.subscribeAsync("#");
}
