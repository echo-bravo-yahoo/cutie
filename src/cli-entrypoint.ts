#!/usr/bin/env node

import { srcDir, start } from "./index.js";
import parser, { Arguments } from "yargs-parser";
import initializeConfig from "./util/init.js";

export interface CLIArgs {
  config: string;
}

const argv = parser(process.argv.slice(2) || "", {
  string: ["config"],
  default: {
    config: `${process.cwd()}/cutie.conf.json`,
  },
}) as Arguments & CLIArgs;

if (argv._.length && argv._[0] === "init") {
  initializeConfig(argv);
} else {
  start(argv);
}
