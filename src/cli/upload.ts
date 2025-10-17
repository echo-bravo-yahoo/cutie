import { readFile } from "node:fs/promises";
import { normalize } from "node:path";

import parser from "yargs-parser";

import { Connection } from "../util/Connection.js";
import { CLIArgs, parserDefaults } from "../util/cli.js";
import { fetchConfig } from "../util/configs.js";
import { initializeGlobals } from "../index.js";
import { registerTasks } from "../util/tasks.js";
import {
  getConnection,
  mergeParserArgs,
  registerConnections,
} from "../util/connections.js";

export interface UploadArgs extends CLIArgs {
  connectionName: string;
  path: string;
  node: string;
}

async function uploadSingle(args: UploadArgs, connection: Connection) {
  const filePath = normalize(args.path);
  const config = (await readFile(filePath)).toString();
  return connection.uploadSingleConfig(args.node, JSON.parse(config));
}

async function uploadAll(args: UploadArgs, connection: Connection) {}

export default async function upload(_parserDefaults: parser.Options) {
  const downloadParserArgs = {
    string: ["path", "node", "connectionName"],
  };

  const args = parser(
    process.argv.slice(2) || "",
    mergeParserArgs(parserDefaults, downloadParserArgs),
  ) as UploadArgs;

  const config = await fetchConfig(args.config);
  initializeGlobals();
  await registerTasks(config.tasks);
  await registerConnections(config.connections);
  const connection = getConnection(args.connectionName);

  if (args.node) {
    await uploadSingle(args, connection);
  } else {
    await uploadAll(args, connection);
  }

  // TO-DO: figure out why node doesn't exit cleanly
  // from this command...
  process.exit(0);
}
