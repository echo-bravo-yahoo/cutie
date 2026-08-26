import { Router } from "express";

import MQTTConnection from "../../connections/mqtt.js";
import { ConfigFile } from "../../util/configs.js";
import { validateConfig } from "../../util/validate.js";
import { discoverNodes, publishNode } from "../mqtt-bridge.js";

export function createNodesRouter(
  connection: MQTTConnection,
  topic?: string,
): Router {
  const router = Router();

  // Small home fleet: the same full payload serves both the node list and the
  // detail view, with no pagination or per-node lazy loading.
  router.get("/", async (_req, res) => {
    res.json(await discoverNodes(connection, topic));
  });

  router.put("/:name", async (req, res) => {
    const result = await publishNode(
      connection,
      req.params.name,
      req.body as ConfigFile,
      topic,
    );

    if (result.ok) res.json(result);
    else res.status(422).json(result);
  });

  // No publish here: used for live inline validation as the operator edits.
  router.post("/:name/validate", async (req, res) => {
    res.json({
      errors: await validateConfig(req.body, {
        configPath: req.params.name,
      }),
    });
  });

  return router;
}
