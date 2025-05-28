import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals } from "../index.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerInputs(tasks) {
  const inputNames = (await readdir(normalize(`${__dirname}/../inputs`))).map(
    (name) => basename(name, ".js")
  );

  globals.logger.info({ role: "breadcrumb" }, "Registering inputs...");
  const promises = [];

  for (const task of Object.values(tasks)) {
    const inputConfig = task.steps[0];
    const type = inputConfig.type.split(":")[1];
    if (inputNames.includes(type)) {
      const newIndex = globals.inputs.length;
      const Input = await getInputFactory(type);
      const newInput = new Input(inputConfig, task);

      globals.inputs.push(newInput);
      promises.push(newInput.register());
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered input of type ${type} in index ${newIndex}.`
      );
    }
  }

  await Promise.all(promises);
  globals.logger.info({ role: "breadcrumb" }, "Input registration completed.");
}

export function getInputs(tasks) {
  return Object.values(tasks.steps)
    .flat()
    .filter((task) => task.type.startsWith("input:"));
}

export function getInput(inputKey) {
  return globals.inputs.find((input) => input.config.name === inputKey);
}

async function getInputFactory(type) {
  return (await import(normalize(`${__dirname}/../inputs/${type}.js`))).default;
}
