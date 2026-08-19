import { writeFile } from "node:fs/promises";
import { normalize } from "node:path";

import parser from "yargs-parser";

import { globals, initializeGlobals } from "../index.js";
import { configFileNameForNode, fetchConfig } from "../util/configs.js";
import { getConnection, registerConnections } from "../util/connections.js";
import {
  ProvidingConnection,
  requireConfigProvider,
} from "../util/Connection.js";
import { CLIArgs, mergeParserArgs, parserDefaults } from "../util/cli.js";

export interface DownloadArgs extends Omit<CLIArgs, "_"> {
  connectionName: string;
  path?: string;
  node?: string;
  topic?: string;
}

interface DownloadSingleArgs extends DownloadArgs {
  node: string;
}

// usage: `npm run build; ./built/cli-entrypoint.js download --config ./config/cutie-downloader.conf.json --connectionName personal-mqtt --path ./config-management`
async function downloadSingle(
  args: DownloadSingleArgs,
  connection: ProvidingConnection,
) {
  const filePath = normalize(
    `${args.path ?? "."}/${configFileNameForNode(args.node)}`,
  );
  await writeFile(
    filePath,
    JSON.stringify(
      await connection.fetchSingleConfig(args.node, args.topic),
      null,
      4,
    ),
  );
}

async function downloadAll(
  args: DownloadArgs,
  connection: ProvidingConnection,
) {
  const configs = await connection.fetchAllConfigs(args.topic);
  if (!configs)
    throw new Error(
      `Connection "${connection.name}" returned no configs to download.`,
    );
  const promises = [];
  for (const [name, config] of Object.entries(configs)) {
    const filePath = normalize(
      `${args.path ?? "."}/${configFileNameForNode(name)}`,
    );
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

export function parseDownloadArgs(args: Array<string> = process.argv.slice(2)) {
  const downloadParserArgs = {
    string: ["path", "node", "connectionName", "topic"],
  };

  return parser(
    args,
    mergeParserArgs(parserDefaults, downloadParserArgs),
  ) as unknown as DownloadArgs;
}

export default async function download(args: DownloadArgs) {
  initializeGlobals(args.logLevel, args.config);
  const config = await fetchConfig(args.config);
  // Deliberately no registerTasks here: downloading config should not start
  // live triggers.
  await registerConnections(config.connections);
  const connection = requireConfigProvider(getConnection(args.connectionName));

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
