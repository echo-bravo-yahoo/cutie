import { copyFile } from "node:fs/promises";

import { srcDir } from "../index.js";

export default async function initializeConfig() {
  const destPath = `${process.cwd()}/cutie.conf.json`;
  const srcPath = `${srcDir}/../config/cutie.conf.json`;
  console.log(`Creating default config file at ${destPath}.`);
  await copyFile(srcPath, destPath);
  console.log(`Created default config file.`);
}
