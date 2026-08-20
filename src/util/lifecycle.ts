import { globals } from "./globals.js";

// What a reload releases: everything the config built. Split from shutdown
// because a reload has to keep the connection that will deliver the next
// config change, and a shutdown must not.
export async function teardown() {
  await Promise.allSettled([
    ...globals.tasks.flatMap((task) => [
      task.trigger?.disable(),
      ...task.steps.map((step) => step.disable()),
    ]),
    ...globals.connections.map((connection) => connection.disable()),
  ]);
}

export async function shutdown() {
  await teardown();
  // Settled rather than awaited bare: a rejection escaping a signal handler is
  // an unhandled rejection, which would turn a clean stop into an exit of 1.
  await Promise.allSettled([globals.configConnection?.disable()]);
}
