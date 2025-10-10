import { srcDir } from "../index.js";
import { copyFile } from "node:fs/promises";
import { CLIArgs } from "../cli-entrypoint.js";

export default async function initializeConfig(_args: CLIArgs) {
  const destPath = `${process.cwd()}/cutie.conf.json`;
  const srcPath = `${srcDir}/../config/cutie.conf.json`;
  console.log(`Creating default config file at ${destPath}.`);
  await copyFile(srcPath, destPath);
  console.log(`Created default config file.`);
}
