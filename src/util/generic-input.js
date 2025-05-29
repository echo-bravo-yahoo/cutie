import { normalize } from "node:path";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import get from "lodash/get.js";

import { globals } from "../index.js";
import { Step } from "./generic-step.js";

export default class Input extends Step {
  constructor(config, task) {
    super(config, task);
  }
}
