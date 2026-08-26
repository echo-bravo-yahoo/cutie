import { createServer, Server } from "node:http";
import { join, normalize } from "node:path";

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
}: StartServerOptions): Promise<Server> {
  const app = express();
  app.use(express.json());

  app.use("/api/nodes", createNodesRouter(connection, topic));
  app.use("/api/modules", createModulesRouter());

  app.use(express.static(DIST_DIR));
  // A plain middleware, not a route pattern, so the SPA fallback works the
  // same whether Express's router treats a bare "*" as a wildcard or not.
  app.use((_req, res) => res.sendFile(join(DIST_DIR, "index.html")));

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
