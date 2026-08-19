import { globals } from "./index.js";

// How long to wait for the event loop to drain on its own before forcing the
// exit, in ms.
const FORCED_EXIT_DELAY = 2000;

// Disables everything that holds a timer, a socket, or a listener, so a
// signalled shutdown closes cleanly instead of being killed mid-flight.
async function cleanUp() {
  await Promise.allSettled([
    ...globals.tasks.flatMap((task) => [
      task.trigger?.disable(),
      ...task.steps.map((step) => step.disable()),
    ]),
    ...globals.connections.map((connection) => connection.disable()),
  ]);
}

// Once cleanUp has released every timer and socket the event loop drains by
// itself, which is also what gives pino's transport thread a chance to flush
// the final lines -- process.exit() would kill it mid-write. The watchdog is
// unref'd, so it only ever fires if something failed to release.
function exitWhenDrained(process: NodeJS.Process, code: number) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), FORCED_EXIT_DELAY).unref();
}

export function setupProcess(process: NodeJS.Process) {
  process.on("SIGTERM", async (_signal) => {
    globals.logger.info(
      `Process ${process.pid} received SIGTERM signal. Terminating.`,
    );
    await cleanUp();
    // a signalled stop is a clean stop; only a crash exits non-zero
    exitWhenDrained(process, 0);
  });

  process.on("SIGINT", async (_signal) => {
    globals.logger.info(
      `Process ${process.pid} received SIGINT signal. Terminating.`,
    );
    await cleanUp();
    exitWhenDrained(process, 0);
  });

  // The line is awaited, unlike a signal handler's: cleanUp disables every log
  // listener, so a line emitted and then immediately abandoned is lost by the
  // task whose whole job is republishing it -- and this is the one line that
  // says why the node stopped.
  const crash = async (message: string, object: object) => {
    await globals.logger.fatal(message, object);
    await cleanUp();
    exitWhenDrained(process, 1);
  };

  process.on("uncaughtException", (err, origin) =>
    crash("Uncaught Exception. Terminating now.", { err, origin }),
  );

  // Without this Node reports a rejection nothing caught as an uncaught
  // exception, which names neither the reason nor that a promise was involved.
  process.on("unhandledRejection", (reason) =>
    crash("Unhandled Rejection. Terminating now.", {
      err: reason,
      origin: "unhandledRejection",
    }),
  );
}
