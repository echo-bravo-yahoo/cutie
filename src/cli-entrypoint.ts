#!/usr/bin/env node

import { normalize } from "node:path";
import { pathToFileURL } from "node:url";

import parser from "yargs-parser";
import { readSync } from "node-yaml";

import { srcDir, start } from "./index.js";
import initializeConfig from "./cli/init.js";
import upload, { parseUploadArgs } from "./cli/upload.js";
import download, { parseDownloadArgs } from "./cli/download.js";
import validate, { parseValidateArgs } from "./cli/validate.js";
import {
  SUBCOMMANDS,
  parserDefaults,
  unknownFlagErrors,
  usageFor,
} from "./util/cli.js";

// Returns the exit code rather than calling process.exit, so a test can drive
// the whole dispatch without taking the test runner down with it.
export async function main(args: Array<string>): Promise<number> {
  const argv = parser(args, parserDefaults);
  const requested = argv._.length ? `${argv._[0]}` : "start";
  const subcommand = SUBCOMMANDS[requested] ? requested : undefined;

  if (subcommand === undefined) {
    console.error(`Unknown command "${requested}".\n\n${usageFor()}`);
    return 1;
  }

  // A bare `cutie --help` lists the commands; `cutie upload --help` lists that
  // command's own flags.
  if (argv.help) {
    console.log(usageFor(argv._.length ? subcommand : undefined));
    return 0;
  }

  if (argv.version) {
    console.log(readSync(normalize(`${srcDir}/../package.json`)).version);
    return 0;
  }

  const problems = unknownFlagErrors(argv, subcommand);

  if (problems.length) {
    console.error(`${problems.join("\n")}\n\n${usageFor(subcommand)}`);
    return 1;
  }

  if (subcommand === "init") {
    await initializeConfig();
  } else if (subcommand === "upload") {
    await upload(parseUploadArgs(args));
  } else if (subcommand === "download") {
    await download(parseDownloadArgs(args));
  } else if (subcommand === "validate") {
    return (await validate(parseValidateArgs(args))) ? 0 : 1;
  } else {
    await start();
  }

  return process.exitCode === undefined ? 0 : Number(process.exitCode);
}

// Only the CLI invocation runs; importing this file for its `main` export does
// not.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
