import { readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import parser from "yargs-parser";
import { read as readConfigFile } from "node-yaml";

import {
  ProvidingConnection,
  requireConfigProvider,
} from "../util/Connection.js";
import { CLIArgs, mergeParserArgs, parserDefaults } from "../util/cli.js";
import { fetchConfig, nodeNameFromPath } from "../util/configs.js";
import { globals, initializeGlobals } from "../index.js";
import { getConnection, registerConnections } from "../util/connections.js";
import { Dirent } from "node:fs";

export interface UploadArgs extends Omit<CLIArgs, "_"> {
  connectionName: string;
  path: string;
  node: string;
  topic?: string;
}

async function uploadSingle(args: UploadArgs, connection: ProvidingConnection) {
  // node-yaml's reader parses JSON too -- YAML 1.2 is a JSON superset -- so
  // one reader covers every extension isDirEntConfigLike accepts.
  const config = await readConfigFile(normalize(args.path));
  return connection.uploadSingleConfig(args.node, config, args.topic);
}

function isDirEntConfigLike(dirEnt: Dirent) {
  return (
    dirEnt.isFile() && [".json", ".yaml", ".yml"].includes(extname(dirEnt.name))
  );
}

async function uploadFromDirEnt(
  dirEnt: Dirent,
  connection: ProvidingConnection,
  topic?: string,
) {
  // With readdir({recursive: true}), dirEnt.name is a bare basename and the
  // directory it came from is on dirEnt.parentPath.
  const configFile = await readConfigFile(join(dirEnt.parentPath, dirEnt.name));
  return connection.uploadSingleConfig(
    nodeNameFromPath(dirEnt.name),
    configFile,
    topic,
  );
}

async function uploadAll(args: UploadArgs, connection: ProvidingConnection) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promises: Array<Promise<any>> = [];

  (
    await readdir(args.path, {
      withFileTypes: true,
      recursive: true,
    })
  )
    .filter(isDirEntConfigLike)
    .forEach((file) =>
      promises.push(uploadFromDirEnt(file, connection, args.topic)),
    );

  return Promise.all(promises);
}

export function parseUploadArgs(args: Array<string> = process.argv.slice(2)) {
  const uploadParserArgs = {
    string: ["path", "node", "connectionName", "topic"],
  };

  return parser(
    args,
    mergeParserArgs(parserDefaults, uploadParserArgs),
  ) as unknown as UploadArgs;
}

export default async function upload(args: UploadArgs) {
  initializeGlobals(args.logLevel, args.config);
  const config = await fetchConfig(args.config);
  // Deliberately no registerTasks here: uploading config should not start
  // live triggers.
  await registerConnections(config.connections);
  // No tasks here means no trigger:logs task will ever turn up, so the window
  // for holding lines is already over.
  globals.logger.stopBuffering();
  const connection = requireConfigProvider(getConnection(args.connectionName));

  if (args.node) {
    await uploadSingle(args, connection);
  } else {
    await uploadAll(args, connection);
  }

  return Promise.all(
    globals.connections.map((connection) => connection.disable()),
  );
}
