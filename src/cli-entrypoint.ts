#!/usr/bin/env node

import parser from "yargs-parser";

import { start } from "./index.js";
import initializeConfig from "./cli/init.js";
import upload, { parseUploadArgs } from "./cli/upload.js";
import download, { parseDownloadArgs } from "./cli/download.js";
import { parserDefaults } from "./util/cli.js";

const argv = parser(process.argv.slice(2) || "", parserDefaults);
const subcommand = argv._.length ? argv._[0] : undefined;

if (subcommand === "init") {
  initializeConfig();
} else if (subcommand === "upload") {
  upload(parseUploadArgs());
} else if (subcommand === "download") {
  download(parseDownloadArgs());
} else if (subcommand === "start") {
  start();
} else {
  throw new Error(
    `Unknown subcommand ${subcommand}! Valid subcommands are "start", "init", "upload", or "download".`,
  );
}
