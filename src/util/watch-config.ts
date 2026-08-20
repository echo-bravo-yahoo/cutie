import { FSWatcher, watch } from "node:fs";

import { reload } from "../index.js";
import { ConfigFile, fetchConfig, fetchLocalConfig } from "./configs.js";
import { globals } from "./globals.js";
import { ProviderConfig } from "./type-helpers.js";

// fs.watch fires two or three times for one save, and an editor that truncates
// before writing briefly leaves an empty file behind.
const DEBOUNCE_MS = 250;

let running: string;
// Chained rather than guarded by a boolean: two saves in quick succession must
// both be applied, in order, not have the second dropped.
let pending: Promise<unknown> = Promise.resolve();
// One config watch at a time; arming a new one closes whatever it replaces.
let watcher: FSWatcher | undefined;
let timer: NodeJS.Timeout | undefined;

function apply(next: ConfigFile, configPath: string) {
  // Serialised, not deep-compared: subscribing to a retained topic redelivers
  // the config the node just fetched, and the local file's mtime changes when
  // its bytes do not.
  const serialized = JSON.stringify(next);
  if (serialized === running) return;

  pending = pending
    .then(async () => {
      if (await reload(next, configPath)) running = serialized;
    })
    .catch((error: unknown) =>
      globals.logger.error(`Reload failed: ${error}.`),
    );
}

async function watchRemote(configPath: string, provider: ProviderConfig) {
  const connection = globals.configConnection;

  // The node fell back to its cached config, so no connection is holding the
  // topic open and there is no channel a change could arrive on. Restarting
  // once the broker is reachable again is the only way back.
  if (!connection) {
    globals.logger.warn(
      `Not watching for config changes: the config at "${configPath}" names a provider, but no connection to it survived startup.`,
    );
    return;
  }

  await connection.watchConfig(provider, (next) => apply(next, configPath));
}

// The file itself, never the directory holding it: fetchConfig writes
// <config>.cache.json beside the config, and a directory watch would reload on
// its own cache write for as long as the node stayed up.
function watchLocal(configPath: string) {
  function arm() {
    watcher = watch(configPath, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fire(), DEBOUNCE_MS);
    });
    // Unref'd, like the forced-exit watchdog in src/process.ts: watching a
    // config is not by itself a reason for a node to stay up, and a watch that
    // held the event loop open would stop a signalled shutdown from draining,
    // leaving the two-second watchdog to kill pino mid-flush.
    watcher.unref();
  }

  async function fire() {
    // Re-armed rather than left in place: an editor that saves by renaming a
    // new file over the old one leaves this watcher on an inode nothing will
    // ever write to again, and the node would go deaf with no sign of it.
    watcher?.close();

    try {
      arm();
    } catch (error) {
      watcher = undefined;
      globals.logger.error(
        `Stopped watching "${configPath}" for config changes: ${error}.`,
      );
    }

    try {
      apply(await fetchConfig(configPath), configPath);
    } catch (error) {
      // Half-written files read as broken YAML. Refused and logged, like a
      // config that fails validation; the save that finishes fires again.
      globals.logger.error(
        `Could not read the changed config at "${configPath}": ${error}.`,
      );
    }
  }

  arm();
  globals.logger.info(`Watching "${configPath}" for config changes.`);
}

// Starts watching wherever this node's config actually lives, so a published
// or edited config takes effect without a restart.
export async function watchConfig(configPath: string, config: ConfigFile) {
  // Seeded with what start() registered, so the retained message a subscribe
  // immediately redelivers is recognised as the config already in force.
  running = JSON.stringify(config);

  if (timer) clearTimeout(timer);
  watcher?.close();
  watcher = undefined;

  // A local file naming a configProvider is a bootstrap and the config is the
  // retained message, so the topic is what to watch; a local file naming none
  // is itself the config. Never both: re-reading a bootstrap's broker
  // credentials would mean tearing down the channel delivering the change.
  const local = await fetchLocalConfig(configPath);

  if (local.configProvider)
    return watchRemote(configPath, local.configProvider);

  watchLocal(configPath);
}
