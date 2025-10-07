import { writeFile } from "node:fs/promises";
import { normalize } from "node:path";

import parser from "yargs-parser";

import { globals, initializeGlobals } from "../index.js";
import { fetchConfig } from "../util/configs.js";
import {
  getConnection,
  mergeParserArgs,
  registerConnections,
} from "../util/connections.js";
import { registerTasks } from "../util/tasks.js";
import { Connection } from "../util/Connection.js";
import { CLIArgs, parserDefaults } from "../util/cli.js";

export interface DownloadArgs extends Omit<CLIArgs, "_"> {
  connectionName: string;
  path?: string;
  node?: string;
}

interface DownloadSingleArgs extends DownloadArgs {
  node: string;
}

// usage: `npm run build; ./built/cli-entrypoint.js download --config ./config/cutie-downloader.conf.json --connectionName personal-mqtt --path ./config-management`
async function downloadSingle(
  args: DownloadSingleArgs,
  connection: Connection,
) {
  const filePath = `${normalize(`${args.path ?? "."}/${args.node}`)}.conf.json`;
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
    const filePath = `${normalize(`${args.path ?? "."}/${name}`)}.conf.json`;
    promises.push(writeFile(filePath, JSON.stringify(config, null, 4)));
  }
  await Promise.all(promises);

  console.log(
    `Done downloading ${Object.keys(configs).length} configs. Cleaning up.`,
  );
  return Promise.all(
    globals.connections.map((connection) => {
      return connection.disable();
    }),
  ).then(() => (globals.connections = []));
}

export function parseDownloadArgs() {
  const downloadParserArgs = {
    string: ["path", "node", "connectionName"],
  };

  return parser(
    process.argv.slice(2) || "",
    mergeParserArgs(parserDefaults, downloadParserArgs),
  ) as unknown as DownloadArgs;
}

export default async function download(args: DownloadArgs) {
  initializeGlobals();
  const config = await fetchConfig(args.config);
  await registerConnections(config.connections);
  await registerTasks(config.tasks ?? []);
  const connection = getConnection(args.connectionName);

  if (args.node) {
    await downloadSingle(args as DownloadSingleArgs, connection);
  } else {
    await downloadAll(args, connection);
  }

  return Promise.all(
    globals.connections.map((connection) => {
      return connection.disable();
    }),
  );
}
