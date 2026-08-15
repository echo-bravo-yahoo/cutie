import { copyFile, constants } from "node:fs/promises";

import { srcDir } from "../index.js";

export default async function initializeConfig() {
  const destPath = `${process.cwd()}/cutie.conf.json`;
  const srcPath = `${srcDir}/../config/cutie.conf.json`;

  try {
    await copyFile(srcPath, destPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`${destPath} already exists; refusing to overwrite it.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(`Created default config file at ${destPath}.`);
}
