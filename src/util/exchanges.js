import { readdir } from "node:fs/promises";
import { basename, normalize } from "node:path";

import { globals } from "../index.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerExchanges(exchangeConfigs) {
  const exchangeNames = (
    await readdir(normalize(`${__dirname}/../exchanges`))
  ).map((name) => basename(name, ".js"));

  globals.logger.info({ role: "breadcrumb" }, "Registering exchanges...");
  const promises = [];

  for (const exchangeConfig of exchangeConfigs) {
    if (exchangeNames.includes(exchangeConfig.type)) {
      const Exchange = (
        await import(
          normalize(`${__dirname}/../exchanges/${exchangeConfig.type}.js`)
        )
      ).default;

      const newIndex = globals.exchanges.length;
      const newExchange = new Exchange(exchangeConfig);

      globals.exchanges.push(newExchange);
      promises.push(newExchange.register());
      globals.logger.info(
        { role: "breadcrumb" },
        `Registered exchange of type ${exchangeConfig.type} in index ${newIndex}.`
      );
    }
  }

  await Promise.all(promises);
  globals.logger.info(
    { role: "breadcrumb" },
    "Exchange registration completed."
  );
}

export function getExchange(exchangeKey) {
  return globals.exchanges.find(
    (exchange) => exchange.config.name === exchangeKey
  );
}
