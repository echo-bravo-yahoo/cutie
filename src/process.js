import { globals } from "./index.js";

// pino.flush(cb) never calls the cb function, and it appears to flush fine without it
async function cleanUp() {
  let promises = [];
  for (const module of globals.modules) {
    promises.push(module.cleanUp() || Promise.resolve());
  }

  return Promise.all(promises);
}

export function setupProcess(process) {
  process.on("exit", cleanUp);

  process.on("SIGTERM", (_signal) => {
    globals.logger.info(
      { role: "breadcrumb" },
      `Process ${process.pid} received SIGTERM signal. Terminating.`
    );
    process.exit(1);
  });

  process.on("SIGINT", async (_signal) => {
    globals.logger.info(
      { role: "breadcrumb" },
      `Process ${process.pid} received SIGINT signal. Terminating.`
    );
    await cleanUp();
    process.exit(1);
  });

  process.on("uncaughtException", async (err) => {
    globals.logger.fatal({ err }, "Uncaught Exception. Terminating now.");
    await cleanUp();
    process.exit(1);
  });
}
