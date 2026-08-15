#!/usr/bin/env node

import { normalize } from "node:path";

import parser from "yargs-parser";
import { readSync } from "node-yaml";

import { srcDir, start } from "./index.js";
import initializeConfig from "./cli/init.js";
import upload, { parseUploadArgs } from "./cli/upload.js";
import download, { parseDownloadArgs } from "./cli/download.js";
import { parserDefaults } from "./util/cli.js";

const USAGE = `cutie -- automate MQTT interactions

Usage: cutie [command] [options]

Commands:
  start       run the tasks in the config file (default)
  init        write a starter config file to the current directory
  upload      publish local config files to a connection
  download    fetch config files from a connection

Options:
  --config <path>   config file to use (default: ./cutie.conf.json)
  --help            show this message
  --version         show the installed version`;

const argv = parser(process.argv.slice(2) || "", parserDefaults);
const subcommand = argv._.length ? argv._[0] : "start";

if (argv.help) {
  console.log(USAGE);
} else if (argv.version) {
  console.log(readSync(normalize(`${srcDir}/../package.json`)).version);
} else if (subcommand === "init") {
  await initializeConfig();
} else if (subcommand === "upload") {
  await upload(parseUploadArgs());
} else if (subcommand === "download") {
  await download(parseDownloadArgs());
} else if (subcommand === "start") {
  await start();
} else {
  console.error(`Unknown command "${subcommand}".\n\n${USAGE}`);
  process.exit(1);
}
