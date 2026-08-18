import { normalize } from "node:path";

import parser from "yargs-parser";

import { globals, initializeGlobals } from "../index.js";
import { CLIArgs, parserDefaults } from "../util/cli.js";
import { fetchConfig } from "../util/configs.js";
import { reportConfigErrors, validateConfig } from "../util/validate.js";

export function parseValidateArgs(args: Array<string> = process.argv.slice(2)) {
  return parser(args, parserDefaults) as unknown as CLIArgs;
}

export default async function validate(args: CLIArgs) {
  initializeGlobals(args.logLevel, args.config);

  // Reads the config exactly the way start() does, including a remote fetch, so
  // the two never disagree about what is being validated.
  const configPath = normalize(args.config);
  const config = await fetchConfig(args.config);
  const failed = reportConfigErrors(
    await validateConfig(config, { configPath }),
  );

  await Promise.allSettled(
    globals.connections.map((connection) => connection.disable()),
  );
  globals.connections = [];

  if (!failed) console.log(`${configPath} is valid.`);

  return !failed;
}
