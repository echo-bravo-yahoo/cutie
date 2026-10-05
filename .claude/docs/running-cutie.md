# Running cutie

How to install, configure, test, provision, and deploy `cutie`. For why it's built this way, see `.claude/docs/design-principles.md`.

## Quick start

```bash
npm install --global @echobravoyahoo/cutie
cutie init      # writes a starter cutie.conf.yaml in the current directory
cutie validate  # reports everything wrong with it at once
cutie           # runs cutie using ./cutie.conf.yaml
```

Node 22-24 is required (`package.json:48-50`). There is no upper bound on the Python version: `package.json` pins `"node-gyp": "^11.0.0"` in `overrides` (lines 95-99), and node-gyp 10 and later handle Python 3.12, so the old "ARMv6 needs Python 3.10 or earlier" workaround is obsolete (`README.md:150-152`).

## Local development

```bash
git clone git@github.com:echo-bravo-yahoo/cutie.git
cd cutie
npm install
npm link      # optional: installs the `cutie` CLI to PATH
npm start     # runs against ./config/cutie.conf.yaml
```

`npm start` is `npx tsx ./src/cli-entrypoint.ts start --config ./config/cutie.conf.yaml` (`package.json:37`) — it runs TypeScript directly via `tsx`, no build step needed for local iteration. `npm run build` (`tsc`, then chmods the built entrypoint) produces `./built/cli-entrypoint.js`, which is what the systemd service and Docker image actually run.

`read:random` needs no hardware — put it where a real sensor's read would go and the rest of the task behaves the same, which makes it the way to exercise a new transform or output chain on a dev machine (`sensors.md:74-100`).

## CLI reference

Entry point: `src/cli-entrypoint.ts`. Global flag `--config <path>` (default `./cutie.conf.yaml`) selects the config file; config files can be JSON or YAML with any extension. `--log-level <level>` sets the lowest level that reaches the console. An unrecognized flag is an error, and the message suggests the closest real one (`src/util/cli.ts:208-236`).

- `cutie` / `cutie start` — run the tasks in the config file (default subcommand).
- `cutie init` — write a starter config file to the current directory; refuses to overwrite an existing one.
- `cutie validate` — check the config file against the module schemas and report every problem found, without running anything.
- `cutie upload --config <path> --connectionName <name> --path <file-or-dir> [--node <name>] [--topic <topic>]` — publish local config file(s) to a connection as retained messages.
- `cutie download --config <path> --connectionName <name> [--path <dir>] [--node <name>] [--topic <topic>]` — fetch config(s) from a connection, writing `<node>.conf.json` files.
- `cutie serve-ui --config <path> --connectionName <name> [--topic <topic>] [--port <port>] [--host <host>]` — run the local web UI for browsing and editing a fleet's configs.
- `--help`, `--version`

See "Remote config over MQTT" below for what `upload`/`download` are for, and "Web UI" for `serve-ui`.

## Config shape

```text
connections: [ { type: "connection:mqtt" | "connection:influxdb", name, ... } ]
tasks: {
  <task-name>: {
    trigger: { type: "trigger:...", ... },   // starts the task; never a step
    steps: [ { type: "read:..." | "transform:..." | "output:...", ... }, ... ]
  }
}
```

A connection is declared once and referenced by `connectionName` from any trigger/output that needs it (`cookbook.md:7`).

## Step-type inventory

Type string is `<kind>:<subKind>`, and loads `src/<kind>s/<subKind>.ts` (see design-principles.md). Verified against the working tree on 2026-08-18; a given fleet device may run an older or feature-branch ref — see `~/.claude/docs/cutie-fleet.md`. Every option every module accepts is in the generated reference, `docs/reference/README.md`.

**Triggers** (`src/triggers/`) — start a task:

- `trigger:once` — fires one (optionally delayed, interpolated) message, then stops.
- `trigger:repeat` — fires a fixed message on a fixed interval.
- `trigger:cron` — fires a fixed message on a cron schedule.
- `trigger:mqtt` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — starts a task when a message arrives on a subscribed MQTT topic.
- `trigger:event` — starts a task when the in-process event bus emits a key.
- `trigger:file-change` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — starts a task on filesystem change events.
- `trigger:logs` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — starts a task for internal log lines matching `filters` (`*` wildcard, `!` negates, last match wins).
- `trigger:infrared` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — GPIO IR receiver; emits raw `{level, tick}` edges (decoding is left to downstream steps).
- `trigger:nec` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — GPIO IR receiver that decodes the NEC protocol itself, emitting `{address, command, extendedAddress, extendedCommand}`.
- `trigger:gpio-button` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — starts a `{button, pressed}` message when an active-low button wired to a GPIO pin changes.

**Reads** (`src/reads/`) — replace the message with a fresh reading; pair with a trigger like `trigger:repeat`:

- `read:bme280` — temperature/humidity/pressure over I2C.
- `read:bme680` — BME280 fields plus gas-resistance (VOC).
- `read:ltr559` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — ambient light and proximity over I2C.
- `read:ble` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — Bluetooth signal strength for named devices, one sample per call, as `{metadata: {timestamp}, devices: {<label>: {rssi}}}`; a device that was not seen is left out rather than reported at a floor value.
- `read:mems-mic` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — sound level from a MEMS I2S digital microphone over ALSA; each read is itself a multi-second capture.
- `read:random` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — numeric walk, no hardware.
- `read:constant` — replaces the message with a fixed, interpolated literal.
- `read:stash` — replaces the message with a value from the task's stash.
- `read:file` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — replaces the message with a file's contents (path interpolated, `encoding` configurable).

**Transforms** (`src/transforms/`):

- `transform:round` — rounds a numeric value/paths to a precision (up/down/round).
- `transform:convert` — unit conversion (currently celsius<->fahrenheit only).
- `transform:offset` — adds a fixed offset to a value/paths.
- `transform:merge` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — deep-merges additional objects into the message; each source is a literal object or a `${...}` template that resolves to one.
- `transform:munge` — rename/duplicate/remove/retain keys by path, with a `"*"` wildcard default.
- `transform:accumulate` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — buffers messages, then forwards them as one array once `count` have arrived or the oldest has waited `maxAge`.
- `transform:debounce` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — buffers messages, then forwards them as one array once nothing new has arrived for `idleMs`; unlike `transform:accumulate`, there is no count/max-age escape hatch.
- `transform:ir-pulses` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — converts a buffered array of `trigger:infrared`'s `{level, tick}` edges into `{pulses}`, the raw microsecond-duration shape `output:infrared` transmits.
- `transform:aggregate` — collapses an array of samples into one value via `latest`/`average`/`sum`/`median`/`pX` (`src/util/aggregation.ts`).
- `transform:prettify` / `transform:uglify` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — stringify the message as indented / compact JSON.
- `transform:shell` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — runs a shell command (`command` or `codePath`), coerces stdout to `string`/`number`/`object`.
- `transform:javascript` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — runs JS in a `node:vm` sandbox (`command` or `codePath`), same output coercion. The source is compiled once at registration into a function taking `message`, `stash`, `error`, `task`, `module`, and `env`; it must `return` its result, and it is not interpolated (`src/util/javascript.ts`).

**Controls** (`src/controls/`) — decide what the chain does next rather than changing the message:

- `control:return` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — ends the chain and hands a value back to whatever invoked the task, plus any `stash` keys to publish into the caller's stash. A task that falls off its own end returns nothing. `cutie validate` warns about one in a task nothing invokes.
- `control:branch` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — runs the task named by `task:` from inside this one, then carries on. The target decides what comes back exactly as a rescue does. The name is resolved per message, so a task may branch to one declared after it.
- `control:stop` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — ends the chain here, so the steps after it never run. The message is consumed rather than failed, so it produces no `error` line and does not count as handled.
- `control:delay` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — holds the message here for a fixed `duration` before the rest of the chain runs, via a plain `setTimeout`-backed `await` (costs only this message's own progress, not the process).
- `control:branch` and `control:stop` both take an optional `when`, a JavaScript function body compiled once at registration and read for truthiness. It means the same thing in both: when this holds, do what the module is named for. Omit it to do that every time, and note that a predicate that throws is an ordinary step failure rather than a false condition.

**Outputs** (`src/outputs/`):

- `output:console` — logs the message.
- `output:mqtt` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — publishes to one or more (interpolated) MQTT topics.
- `output:file` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — appends or overwrites a file (path interpolated, `encoding` configurable).
- `output:stash` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — stores an interpolated value into the task's stash.
- `output:event` — emits the message on the in-process event bus.
- `output:logs` — routes a `{log, object, verbosity, topic}` message back into the logger; the sink side of `trigger:logs`.
- `output:influxdb` — writes a line-protocol point to InfluxDB via `connection:influxdb`.
- `output:nec` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — transmits an NEC infrared remote command via `pigpiod` bit-banging, reached over its socket protocol via `pigpio-client`.
- `output:infrared` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — transmits an arbitrary raw infrared pulse train (any protocol, not just NEC) the same way; the message names a saved code or spells one out as `{pulses}`.
- `output:switchbots` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — drives SwitchBot Bot devices (`on`/`off`/`press`) over BLE.
- `output:thermal-printer` <img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="top"> — prints to a serial thermal printer, with a small markdown-heading dialect.
- `output:inky-phat` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — draws each message on an Inky pHAT e-paper panel, 212x104 in three colours, from an image file or a bitmap the message carries.
- `output:st7735` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — draws each message on an ST7735 LCD panel, 80x160 by default, from an image file or a bitmap the message carries.
- `output:unicorn-hat-mini` <img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="top"> — draws each message on a Unicorn HAT Mini, a 17x7 grid of RGB LEDs, from the same two sources.

**Connections** (`src/connections/`):

- `connection:mqtt` — MQTT broker; also the one `ConfigProvider` implementation (retained-message config store), and it reference-counts subscriptions across triggers.
- `connection:influxdb` — InfluxDB v2 HTTP write endpoint; naming it as a config provider is rejected at fetch time (`src/util/Connection.ts:42-51`).

## Remote config over MQTT

A node can fetch its whole config from a connection at startup instead of reading a local file, keeping config for a fleet in one place instead of editing each machine over SSH (`README.md:82-84`).

- A local bootstrap config file with a `configProvider: { connectionName, topic }` block triggers this: cutie registers the connections declared in that local file, fetches the named connection's config for `topic`, tears the other bootstrap connections down, and runs the fetched config's own `connections`/`tasks` instead (`src/util/configs.ts:49-76,154-188`). The provider connection itself is kept, on `globals.configConnection` rather than in `globals.connections`, because it is what carries the next config change.
- For MQTT specifically, `fetchConfig` subscribes to `topic` and resolves on the first (necessarily retained) message it receives (`src/connections/mqtt.ts:130-189`). It rejects on a timeout, and on a retained message that is not JSON, so a node whose config topic holds nothing still reaches the cache below.
- **Live reload.** `watchConfig` (`src/connections/mqtt.ts:193-226`) then holds that subscription open, so a config published after a node has already booted reaches it. The node validates the new config, and on success tears down every task and connection and registers them again from it — the state a cold boot would have produced (`reload`, `src/index.ts:84`). A config that does not validate is refused and logged, and the node keeps running the one it already had. A config that validates but registers no task at all leaves nothing running, so the node logs `fatal` and exits `1` for the supervisor to restart.
- **Which watch a node gets is decided by its local file.** A local file naming a `configProvider` watches the topic and never the file, so changing a provider-backed node's broker credentials or endpoint still needs a restart — those fields are what the watch itself is holding open. A local file naming no provider is the config, so cutie watches the file (`src/util/watch-config.ts`), debounced by 250ms because one save fires `fs.watch` several times. Both paths compare the new config's serialization against the running one, so a retained redelivery or a touched-but-unchanged file is not a reload.
- **Local cache fallback.** On a successful remote fetch, cutie writes `<config>.cache.json` next to the local bootstrap file. If the remote fetch fails on a later boot, it falls back to that cache rather than failing to start (`src/util/configs.ts:121-152`). A node that fell back this way has no live provider connection and so gets no watch at all: it runs its cached config until it is restarted.
- Example: `examples/remote-config.yaml`.

Two subcommands manage the stored configs (also see `README.md:86-112`):

```bash
# publish every config file in a directory, one per file, recursively
cutie upload --config ./cutie.conf.yaml --connectionName my-broker --path ./fleet-configs

# publish just one, naming the node it belongs to
cutie upload --config ./cutie.conf.yaml --connectionName my-broker --path ./fleet-configs/kitchen-pi.yaml --node kitchen-pi

# fetch every stored config into a directory
cutie download --config ./cutie.conf.yaml --connectionName my-broker --path ./fleet-configs

# fetch just one
cutie download --config ./cutie.conf.yaml --connectionName my-broker --node kitchen-pi --path ./fleet-configs
```

`--topic` defaults to `cutie/config/+`; the `+` segment stands in for the node name on both subscribe (download) and publish (upload). This substitution is a fleet-CLI-only convenience — a device's own `configProvider.topic` (the topic it fetches at boot) must be a literal string, not a `+` template.

For administering the actual live fleet (which devices exist, their topics, reading current config off the broker), see the global `~/.claude/docs/cutie-admin.md` and `~/.claude/docs/cutie-fleet.md`.

## Web UI

`cutie serve-ui` runs a small local Express/React app for browsing a fleet's configs without hand-reading raw JSON/YAML over MQTT. It connects to a `connection:mqtt` connection the same way `upload`/`download` do, discovers every node with a retained config under the config topic, and renders each one as a free-form canvas of draggable tiles — one per connection and per task, snapping to a 56px grid as they're dragged. Each step within a task tile shows a small indicator dot that brightens (and pulses once) only once real live traffic on that step's own `topics` has actually been observed — nothing pulses on a timer. Clicking a step's "edit" button opens a loupe: a small, freely-draggable floating panel that edits just that one step's fields. There is no module schema loaded client-side, so a loupe's fields are raw key/value pairs (JSON pretty-printed for object/array values), not the generated form a schema would drive.

Editing is local to the browser tab only. The frontend currently has no publish path back to the broker — the backend's `PUT /api/nodes/:name` endpoint (`src/web/routes/nodes.ts`, wired to `uploadSingleConfig`) still exists and still replaces a node's entire retained config, but nothing in `web/` calls it yet. Validation runs continuously against `src/util/validate.ts`'s `validateConfig` (the same function `cutie validate` uses, called over `POST /api/nodes/:name/validate`) and surfaces as both a red tile border and a list in the always-visible right-hand rail. That rail also holds the live message feed: it subscribes to the whole broker (`#`) once at server startup and streams it to the browser over a WebSocket, defaulting to whichever topics the selected node's own `trigger:mqtt`/`output:mqtt` steps name, with a toggle back to the raw firehose.

The frontend is a separate npm package at `web/` (its own `package.json`/lockfile, not part of the root TypeScript build or the published npm package) and has to be built before `serve-ui` has anything to serve:

```bash
cd web && npm install && npm run build   # writes web/dist/, which src/web/server.ts serves as static files
cutie serve-ui --config ./cutie.conf.yaml --connectionName my-broker
```

Flags: `--connectionName <name>` (required, as with `upload`/`download`), `--topic <topic>` (defaults to `cutie/config/+`, same substitution rules as above), `--port <port>` (default `4200`), `--host <host>` (default `127.0.0.1`). It binds to localhost with no authentication by design — it is meant to be run on demand from an operator's own machine for the length of an editing session, not left running or exposed on the network. Onboarding a brand-new device with no retained config yet is out of scope: the UI manages nodes the broker already knows about.

## Provisioning a new Pi

`provisioner/` builds an SD card image, and splits the work in two. `provision.mjs` owns the **identity** configuration — user password, wifi, locale, SSH keys, and the services a headless Trixie host needs disabled — which is applied at image time and never re-applied to a running host, because getting one wrong strands an unreachable Pi. `configure-host.sh` owns the **convergent** configuration — bus enablement, swap, packages, Node, and the cutie service — and is idempotent, so it is safe to re-apply at any time (`README.md:19-24`, `provisioner/provision.mjs:16-20`).

1. Copy `provisioner/config.example.json` to `provisioner/config.json` (gitignored) and fill in `hostname`, `board`, `wifi.ssid`/`wifi.country`, `locale`, `sshPubKey` or `authorizedKeys`, `cutie.srcPath`/`cutie.destPath`, `cutieConfig`, and the `op://` references under `secrets`. `board` selects both the base image and the Node build: `pi-zero-w` takes the 32-bit armhf image, `pi-zero-2-w` and later take arm64, and an arm64 card will not boot a Pi Zero W (`README.md:296`).
2. Run `provision.mjs` on the operator machine, never on the Pi. Secrets are never read from disk — the caller resolves them into `CUTIE_PI_PASSWORD` and `CUTIE_WIFI_PSK`, which is what `cc-cred run` is for (`provisioner/provision.mjs:9-14`, `README.md:279-286`). It downloads and caches the base image, stages a per-host `cutie.conf.yaml` under its cache directory with `name` set to the hostname and `configProvider.topic` rewritten to `cutie/config/<hostname>` when the config declares an MQTT connection (`provisioner/provision.mjs:116-173`), then runs `sdm --customize` with the identity plugins plus `--cscript configure-host.sh` (`provisioner/provision.mjs:249-330`). `--dry-run` prints that invocation with the secrets masked, which is the quickest way to review the plugin list.
3. Burning is a separate, explicitly confirmed step: `node provisioner/provision.mjs --skip-customize --burn /dev/sdX`. It refuses to run without the device path retyped, or without `CUTIE_BURN_CONFIRM=/dev/sdX` when there is no terminal (`provisioner/provision.mjs:362-407`).
4. `configure-host.sh` runs `npm ci --omit=dev` during sdm's post-install phase, so a freshly burned card boots ready instead of compiling for 15-30 minutes on first use. The same script applies to an already-booted Pi through `provisioner/pi.sh <host> converge`.

The staged config is written under the provisioner's cache directory rather than into `config/`, so a run leaves the working tree clean. Board-specific findings for a Pi Zero W are not committed to this repo (see "Documentation" in `CLAUDE.md`).

## Running as a systemd service

- `npm run add-service` — copies `config/cutie.service` to `/etc/systemd/system/cutie.service` and `config/cutie.journald.conf` to `/etc/systemd/journald@cutie.conf`, reloads systemd, enables the unit.
- `npm run update-service` — the same, plus restarts both the service and its journald namespace. Use this to pick up a new build on an already-provisioned host.
- The shipped `config/cutie.service` runs `User=pi`, `ExecStart=/usr/bin/env npm run start:prod` (`npm run start:prod` is `./built/cli-entrypoint.js start --config ./config/cutie.conf.yaml`, `package.json:38`), `Restart=always`, `RestartSec=2`. `WorkingDirectory` and node's install path vary per host — the comment in the file says so explicitly; treat it as a template each host's live unit is hand-maintained from, not a synced source of truth.
- `LogNamespace=cutie` routes logs to a dedicated journal namespace, capped at 50M total / 10M per file by `config/cutie.journald.conf`. `journalctl -u cutie` alone shows nothing for the deployed service — add `--namespace=cutie`.

## Docker

`Dockerfile` builds from `node:22-slim`, installs the toolchain needed for native modules, runs `npm ci && npm run build`, and defaults `CMD` to `./config/cutie.conf.yaml`, the same bare starter config the systemd path uses, unless a real config is mounted over it. `npm run build:docker` / `build:docker:wsl` build the image. No `docker-compose.yml` exists, and neither GitHub Actions workflow touches Docker — this is a secondary/dev-convenience path, not the one actually exercised for the fleet (that's the Pi-image route via `provisioner/`).

## Deploying code to an existing device

`provisioner/pi.sh <host> <verb>` drives a Pi over SSH from a development machine (`README.md:258-271`). An ARMv6 board is too constrained to develop on directly, so work happens on a workstation and reaches the Pi through this script.

```bash
provisioner/pi.sh <host> deploy    # build locally, rsync built/, restart
provisioner/pi.sh <host> logs      # follow the journal, --namespace=cutie
provisioner/pi.sh <host> rollback  # swap the retained previous build back in
```

`deploy` never copies `node_modules`: native modules are compiled per architecture and per Node ABI, so a copy from a development machine lands unloadable binaries on the Pi. It also syncs `built/` and nothing else, so a build that imports a newly added runtime dependency starts and then dies at the import — sync `package.json` and `package-lock.json` to the device and run `npm install --omit=dev` there first.

`~/.aeby/scripts/cutie-deploy.sh [--ref <git-ref>] [host ...]` is the fleet-wide alternative: it deploys a git ref over SSH, verifies the service comes back healthy, and is documented in `~/.claude/docs/cutie-admin.md`. Either route is a **code** deploy — distinct from the MQTT retained-config mechanism above, which changes a device's runtime _config_ without touching its code.

## Testing

`npm test` runs every file under `test/**/*.ts` via `tsx --test`, with `--experimental-test-module-mocks` enabled, which the suites use to stub imported modules such as `mqtt` and `node:fs` (`package.json:27`). `test/helpers.ts` holds the shared mocks and fixtures, `test/unit/` one suite per area. Three are worth knowing about: `test/unit/examples.ts` runs the example configs end to end, including `remote-config.yaml` against a mocked broker; `test/unit/docs.ts` validates the config blocks embedded in the prose docs against the module schemas; and `test/unit/hierarchy.ts` pins the shape of the `Configurable` tree. Use `npm run test:coverage` for a coverage report, `npm run test:watch` while iterating, and `npm run lint` (eslint) plus `npm run typecheck` (`tsc -p tsconfig.test.json`) alongside.

## Releasing

Releases are cut from `main` only, by pushing a version tag:

```bash
git checkout main
git pull
npm version <patch|minor|major|prerelease>
git push origin main --follow-tags
```

The `Publish` GitHub Actions workflow runs the test suite, publishes to npm via OIDC trusted publishing, and creates a matching GitHub release. A plain version publishes as the `latest` dist-tag; a prerelease version publishes under its own prerelease identifier.
