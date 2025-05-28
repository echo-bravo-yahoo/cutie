import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals } from "../index.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerOutputs(tasks) {
  const outputConfigs = getOutputs(tasks);
  const outputNames = (await readdir(normalize(`${__dirname}/../outputs`))).map(
    (name) => basename(name, ".js")
  );

  globals.logger.info({ role: "breadcrumb" }, "Registering outputs...");
  const promises = [];

  for (const outputConfig of outputConfigs) {
    if (outputNames.includes(outputConfig.type)) {
      const Output = (
        await import(
          normalize(`${__dirname}/../outputs/${outputConfig.type}.js`)
        )
      ).default;

      const newIndex = globals.outputs.length;
      const newOutput = new Output(outputConfig);

      globals.outputs.push(newOutput);
      promises.push(newOutput.register());
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered output of type ${outputConfig.type} in index ${newIndex}.`
      );
    }
  }

  await Promise.all(promises);
  globals.logger.info({ role: "breadcrumb" }, "Output registration completed.");
}

export function getOutputs(tasks) {
  return Object.values(tasks)
    .map((task) => task.steps)
    .flat()
    .filter((task) => task.type.startsWith("output:"));
}

export function getOutput(outputKey) {
  return globals.outputs.find((output) => output.config.name === outputKey);
}
