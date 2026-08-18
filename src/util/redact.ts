const SECRET_KEYS = new Set([
  "password",
  "username",
  "token",
  "apiKey",
  "secret",
]);

// `key` is deliberately not in that set. output:stash, read:stash, output:event,
// and trigger:event all take a `key` that names a place or an event rather than
// a credential, so masking it would blank out the useful half of every
// registration log line and of the interpolation context.

const REDACTED = "[redacted]";

// A credential also hides in a connection endpoint: "mqtt://user:pass@broker"
// carries it in the userinfo, under a key no denylist would catch.
function stripUserinfo(value: string): string {
  let url;

  // Only a value that genuinely parses as a URL is touched, so an ordinary
  // string that happens to contain an "@" is left exactly as it is.
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (!url.username && !url.password) return value;

  url.username = "";
  url.password = "";

  return url.toString();
}

// Config objects reach both pino and trigger:logs listeners; neither is a
// place for credentials. Walks nested values, since a ConfigFile holds an
// array of connections.
export function redact<T>(value: T): T {
  if (typeof value === "string") return stripUserinfo(value) as unknown as T;
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
