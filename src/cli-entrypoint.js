#!/usr/bin/env node

import { start } from "./index.js";
import parser from "yargs-parser";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = parser(process.argv.slice(2) || "", {
  string: ["config"],
  default: {
    config: `${__dirname}/../config/config.json`,
  },
});

start(argv);
