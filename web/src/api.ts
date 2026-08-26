import {
  ConfigError,
  ConfigFile,
  ModuleSchemasByKind,
  NodesResponse,
  PublishResult,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 422)
    throw new Error(`${res.status} ${res.statusText}`);

  return res.json() as Promise<T>;
}

export function fetchNodes(): Promise<NodesResponse> {
  return fetch("/api/nodes").then((res) => json<NodesResponse>(res));
}

export function fetchModules(): Promise<ModuleSchemasByKind> {
  return fetch("/api/modules").then((res) => json<ModuleSchemasByKind>(res));
}

export function publishNode(
  name: string,
  config: ConfigFile,
): Promise<PublishResult> {
  return fetch(`/api/nodes/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then((res) => json<PublishResult>(res));
}

export function validateNode(
  name: string,
  config: ConfigFile,
): Promise<Array<ConfigError>> {
  return fetch(`/api/nodes/${encodeURIComponent(name)}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
    .then((res) => json<{ errors: Array<ConfigError> }>(res))
    .then((body) => body.errors);
}

export interface LiveMessage {
  topic: string;
  payload: unknown;
  timestamp: number;
}

// Opens once for the life of the app (see App.tsx); returns a closer.
export function openMessageFeed(
  onMessage: (message: LiveMessage) => void,
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws/messages`,
  );

  const handleMessage = (event: MessageEvent<string>) => {
    onMessage(JSON.parse(event.data) as LiveMessage);
  };

  socket.addEventListener("message", handleMessage);

  return () => {
    socket.removeEventListener("message", handleMessage);
    socket.close();
  };
}
