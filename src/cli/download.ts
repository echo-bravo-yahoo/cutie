import { writeFile } from "node:fs/promises";
import { normalize } from "node:path";

import parser from "yargs-parser";

import { initializeGlobals } from "../index.js";
import { fetchConfig } from "../util/configs.js";
import {
  getConnection,
  mergeParserArgs,
  registerConnections,
} from "../util/connections.js";
import { registerTasks } from "../util/tasks.js";
import { Connection } from "../util/Connection.js";
import { CLIArgs, ParserDefaults } from "../util/cli.js";

export interface DownloadArgs extends CLIArgs {
  connectionName: string;
  path: string;
  node: string;
}

async function downloadSingle(args: DownloadArgs, connection: Connection) {
  const filePath = `${normalize(`${args.path}/${args.node}`)}.conf.json`;
  await writeFile(
    filePath,
    JSON.stringify(await connection.fetchSingleConfig(args.node), null, 4),
  );
}

async function downloadAll(args: DownloadArgs, connection: Connection) {
  const configs = await connection.fetchAllConfigs();
  if (!configs) throw new Error("!");
  const promises = [];
  for (const [name, config] of Object.entries(configs)) {
    const filePath = `${normalize(`${args.path}/${name}`)}.conf.json`;
    promises.push(writeFile(filePath, JSON.stringify(config, null, 4)));
  }
  await Promise.all(promises);

  console.log(`Done downloading ${Object.keys(configs).length} configs.`);
}

export default async function download(parserDefaults: ParserDefaults) {
  const downloadParserArgs = {
    string: ["path", "node"],
  };

  const args = parser(
    process.argv.slice(2) || "",
    mergeParserArgs(parserDefaults, downloadParserArgs),
  ) as DownloadArgs;

  const config = await fetchConfig(args.config);
  initializeGlobals();
  await registerTasks(config.tasks);
  await registerConnections(config.connections);
  const connection = getConnection(args.connectionName);

  if (args.node) {
    await downloadSingle(args, connection);
  } else {
    await downloadAll(args, connection);
  }

  // TO-DO: figure out why node doesn't exit cleanly
  // from this command...
  process.exit(0);
}
