import { readFile, readdir } from "node:fs/promises";
import { extname, join, normalize, parse } from "node:path";

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
import { Dirent } from "node:fs";

export interface UploadArgs extends Omit<CLIArgs, "_"> {
  connectionName: string;
  path: string;
  node: string;
}

async function uploadSingle(args: UploadArgs, connection: Connection) {
  const filePath = normalize(args.path);
  const config = (await readFile(filePath)).toString();
  return connection.uploadSingleConfig(args.node, JSON.parse(config));
}

function isDirEntConfigLike(dirEnt: Dirent) {
  return (
    dirEnt.isFile() && ["json", "yaml", "yml"].includes(extname(dirEnt.name))
  );
}

function pathToNode(filePath: string) {
  return parse(filePath).name;
}

async function uploadFromDirEnt(
  dirPath: string,
  dirEnt: Dirent,
  connection: Connection,
) {
  return readFile(join(dirPath, dirEnt.name), {
    encoding: "utf8",
  })
    .then((string) => JSON.parse(string))
    .then((configFile) =>
      connection.uploadSingleConfig(pathToNode(dirEnt.name), configFile),
    );
}

async function uploadAll(args: UploadArgs, connection: Connection) {
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
      promises.push(uploadFromDirEnt(args.path, file, connection)),
    );

  return Promise.all(promises);
}

export function parseUploadArgs() {
  const uploadParserArgs = {
    string: ["path", "node", "connectionName"],
  };

  return parser(
    process.argv.slice(2) || "",
    mergeParserArgs(parserDefaults, uploadParserArgs),
  ) as unknown as UploadArgs;
}

export default async function upload(args: UploadArgs) {
  const config = await fetchConfig(args.config);
  initializeGlobals();
  await registerTasks(config.tasks ?? []);
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
