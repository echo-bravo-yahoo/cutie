#!/usr/bin/env node

import { srcDir, start } from "./index.js";
import parser from "yargs-parser";

const argv = parser(process.argv.slice(2) || "", {
  string: ["config"],
  default: {
    config: `${srcDir}/../config/config.json`,
  },
});

start(argv);
