import { globals } from "./index.js";

// pino.flush(cb) never calls the cb function, and it appears to flush fine without it
async function _cleanUp() {
  // let promises = [];
  // for (const module of globals.modules) {
  //   promises.push(module.cleanUp() || Promise.resolve());
  // }
  // return Promise.all(promises);
}

export function setupProcess(process: NodeJS.Process) {
  // process.on("exit", cleanUp);

  process.on("SIGTERM", async (_signal) => {
    globals.logger.info(
      `Process ${process.pid} received SIGTERM signal. Terminating.`,
    );
    // await flushWritableStream(process.stdout);
    // await flushWritableStream(process.stderr);
    process.exit(1);
  });

  process.on("SIGINT", async (_signal) => {
    globals.logger.info(
      `Process ${process.pid} received SIGINT signal. Terminating.`,
    );
    // await cleanUp();
    // await flushWritableStream(process.stdout);
    // await flushWritableStream(process.stderr);
    process.exit(1);
  });

  process.on("uncaughtException", async (err) => {
    globals.logger.fatal("Uncaught Exception. Terminating now.", { err });
    // await cleanUp();
    // await flushWritableStream(process.stdout);
    // await flushWritableStream(process.stderr);
    process.exit(1);
  });
}

function _flushWritableStream(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.write("", "utf8", () => resolve());
  });
}
