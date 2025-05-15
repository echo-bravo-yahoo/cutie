import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals } from "../index.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerDestinations(destinationConfigs) {
  const destinationNames = (
    await readdir(normalize(`${__dirname}/../destinations`))
  ).map((name) => basename(name, ".js"));

  globals.logger.info({ role: "breadcrumb" }, "Registering destinations...");
  const promises = [];

  for (const destinationConfig of destinationConfigs) {
    if (destinationNames.includes(destinationConfig.type)) {
      const Destination = (
        await import(
          normalize(`${__dirname}/../destinations/${destinationConfig.type}.js`)
        )
      ).default;

      const newIndex = globals.destinations.length;
      const newDestination = new Destination(destinationConfig);

      globals.destinations.push(newDestination);
      promises.push(newDestination.register());
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered destination of type ${destinationConfig.type} in index ${newIndex}.`
      );
    }
  }

  await Promise.all(promises);
  globals.logger.info(
    { role: "breadcrumb" },
    "Destination registration completed."
  );
}

export function getDestination(destinationKey) {
  return globals.destinations.find(
    (destination) => destination.config.name === destinationKey
  );
}
