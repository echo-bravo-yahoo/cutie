import { writeFile } from "node:fs/promises";

import { CLIArgs } from "../cli-entrypoint.js";
import { initializeGlobals } from "../index.js";
import { fetchConfig } from "../util/configs.js";
import { getConnection, registerConnections } from "../util/connections.js";

export interface DownloadArgs {
  connectionName: string;
  // out: string;
}

export default async function download(args: CLIArgs & DownloadArgs) {
  const config = await fetchConfig(args.config);
  initializeGlobals();
  await registerConnections(config.connections);
  const configs = await getConnection(args.connectionName).fetchAllConfigs();
  const promises = [];
  for (const [name, config] of Object.entries(configs)) {
    promises.push(
      writeFile(`${name}.conf.json`, JSON.stringify(config, null, 4)),
    );
  }
  await Promise.all(promises);

  console.log("Done downloading configs.");

  return configs;
}
