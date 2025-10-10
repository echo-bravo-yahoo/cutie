#!/usr/bin/env node

import { start } from "./index.js";
import parser, { Arguments } from "yargs-parser";
import initializeConfig from "./cli/init.js";
import upload from "./cli/upload.js";
import download, { DownloadArgs } from "./cli/download.js";

export interface CLIArgs extends Arguments {
  config: string;
}

const argv = parser(process.argv.slice(2) || "", {
  string: ["config"],
  default: {
    config: `${process.cwd()}/cutie.conf.json`,
  },
}) as CLIArgs;

const subcommand = argv._.length ? argv._[0] : undefined;

if (subcommand === "init") {
  initializeConfig(argv);
} else if (subcommand === "upload") {
  upload(argv);
} else if (subcommand === "download") {
  download(argv as unknown as CLIArgs & DownloadArgs);
} else if (subcommand === "start") {
  start(argv);
} else {
  throw new Error(
    `Unknown subcommand ${subcommand}! Valid subcommands are "start", "init", "upload", or "download".`,
  );
}
