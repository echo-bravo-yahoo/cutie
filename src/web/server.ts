import { createServer, Server } from "node:http";
import { normalize } from "node:path";

import express from "express";
import { WebSocketServer } from "ws";

import { srcDir } from "../index.js";
import MQTTConnection from "../connections/mqtt.js";
import { startLiveFeed } from "./mqtt-bridge.js";
import { createModulesRouter } from "./routes/modules.js";
import { createNodesRouter } from "./routes/nodes.js";

export interface StartServerOptions {
  connection: MQTTConnection;
  topic?: string;
  port: number;
  host: string;
  // Overrides where the built frontend is served from; defaults to the real
  // web/dist/ next to this package. Exists so a test can point it at a fixture
  // directory instead of depending on web/ having been built.
  distDir?: string;
}

// `web/` builds to a static `web/dist/` beside `src/`/`built/`, whichever of
// those this process is running from -- see the "Dependency placement" note
// in the plan for why the frontend toolchain is not part of this package.
const DIST_DIR = normalize(`${srcDir}/../web/dist`);

export async function startServer({
  connection,
  topic,
  port,
  host,
  distDir = DIST_DIR,
}: StartServerOptions): Promise<Server> {
  const app = express();
  app.use(express.json());

  app.use("/api/nodes", createNodesRouter(connection, topic));
  app.use("/api/modules", createModulesRouter());

  app.use(express.static(distDir));
  // A plain middleware, not a route pattern, so the SPA fallback works the
  // same whether Express's router treats a bare "*" as a wildcard or not.
  // The `root` option matters: without it, `send` (which this and
  // express.static both use) checks every segment of the *resolved absolute
  // path* for a leading dot and 404s if it finds one -- which it always
  // would here, since a dotfile-prefixed ancestor directory (like a git
  // worktree under .claude/worktrees/) is common. `root` makes it check only
  // the path relative to distDir instead.
  app.use((_req, res) => res.sendFile("index.html", { root: distDir }));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/messages" });

  await startLiveFeed(connection, (message) => {
    const frame = JSON.stringify(message);

    for (const client of wss.clients)
      if (client.readyState === client.OPEN) client.send(frame);
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.log(`cutie web UI listening on http://${host}:${port}`);

  return httpServer;
}
