const SECRET_KEYS = new Set(["password", "username", "token"]);

const REDACTED = "[redacted]";

// Config objects reach both pino and trigger:logs listeners; neither is a
// place for credentials. Walks nested values, since a ConfigFile holds an
// array of connections.
export function redact<T>(value: T): T {
  if (Array.isArray(value))
    return value.map((item) => redact(item)) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  // Only rebuild plain objects -- a Date or class instance would not survive
  // being reassembled key by key.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = SECRET_KEYS.has(key) ? REDACTED : redact(nested);
  }

  return result as unknown as T;
}
