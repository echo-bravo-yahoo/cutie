import { Arguments } from "yargs-parser";
import { srcDir } from "../index.js";
import { copyFile } from "node:fs/promises";

export default async function initializeConfig(_args: Arguments) {
  const destPath = `${process.cwd()}/cutie.conf.json`;
  const srcPath = `${srcDir}/../config/cutie.conf.json`;
  console.log(`Creating default config file at ${destPath}.`);
  await copyFile(srcPath, destPath);
  console.log(`Created default config file.`);
}
