import { globals } from "./index.js";

// flag to determine if we should run cleanup code
let dirty = true;
let heartbeatHandle;

// pino.flush(cb) never calls the cb function, and it appears to flush fine without it
async function cleanUp() {
  if (dirty) {
    dirty = false;

    let promises = [];
    for (const module in globals.modules) {
      promises.push(globals.modules[module].cleanUp);
    }
    await Promise.all(promises);

    clearInterval(heartbeatHandle);

    if (globals.connection) {
      globals.logger.info(
        { role: "breadcrumb" },
        "Disconnecting from AWS IoT as part of process cleanup..."
      );
      await globals.connection.disconnect();
      globals.logger.info(
        { role: "breadcrumb" },
        "Disconnected from AWS IoT as part of process cleanup."
      );
    } else {
      globals.logger.info(
        { role: "breadcrumb" },
        "No connection to AWS IoT was opened; skipping disconnect."
      );
    }
  }
}

export function setupHeartbeat(interval = 60000) {
  if (!heartbeatHandle) {
    heartbeatHandle = setInterval(() => {}, interval);
  }
}

export function setupProcess(process) {
  process.on("exit", cleanUp);

  process.on("SIGTERM", (signal) => {
    globals.logger.info(
      { role: "breadcrumb" },
      `Process ${process.pid} received SIGTERM signal. Terminating.`
    );
    process.exit(1);
  });

  process.on("SIGINT", async (signal) => {
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
