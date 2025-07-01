import { globals } from "./index.js";
import { Globals } from "./util/generic-loggable.js";

// pino.flush(cb) never calls the cb function, and it appears to flush fine without it
async function cleanUp() {
  // let promises = [];
  // for (const module of globals.modules) {
  //   promises.push(module.cleanUp() || Promise.resolve());
  // }
  // return Promise.all(promises);
}

export function setupProcess(process: NodeJS.Process) {
  process.on("exit", cleanUp);

  process.on("SIGTERM", (_signal) => {
    (globals as Globals).logger.info(
      `Process ${process.pid} received SIGTERM signal. Terminating.`
    );
    process.exit(1);
  });

  process.on("SIGINT", async (_signal) => {
    (globals as Globals).logger.info(
      `Process ${process.pid} received SIGINT signal. Terminating.`
    );
    await cleanUp();
    process.exit(1);
  });

  process.on("uncaughtException", async (err) => {
    (globals as Globals).logger.fatal(
      { err },
      "Uncaught Exception. Terminating now."
    );
    await cleanUp();
    process.exit(1);
  });
}
