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
- `--help`, `--version`

See "Remote config over MQTT" below for what `upload`/`download` are for.

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
- `trigger:mqtt` — starts a task when a message arrives on a subscribed MQTT topic.
- `trigger:event` — starts a task when the in-process event bus emits a key.
- `trigger:file-change` — starts a task on filesystem change events.
- `trigger:logs` — starts a task for internal log lines matching `filters` (`*` wildcard, `!` negates, last match wins).
- `trigger:infrared` — GPIO IR receiver; emits raw `{level, tick}` edges (decoding is left to downstream steps).
- `trigger:gpio-button` — starts a `{button, pressed}` message when an active-low button wired to a GPIO pin changes.

**Reads** (`src/reads/`) — replace the message with a fresh reading; pair with a trigger like `trigger:repeat`:

- `read:bme280` — temperature/humidity/pressure over I2C.
- `read:bme680` — BME280 fields plus gas-resistance (VOC).
- `read:ble` — Bluetooth signal strength for named devices, one sample per call, as `{metadata: {timestamp}, devices: {<label>: {rssi}}}`; a device that was not seen is left out rather than reported at a floor value.
- `read:random` — numeric walk, no hardware.
- `read:constant` — replaces the message with a fixed, interpolated literal.
- `read:stash` — replaces the message with a value from the task's stash.
- `read:file` — replaces the message with a file's contents (path interpolated, `encoding` configurable).

**Transforms** (`src/transforms/`):

- `transform:round` — rounds a numeric value/paths to a precision (up/down/round).
- `transform:convert` — unit conversion (currently celsius<->fahrenheit only).
- `transform:offset` — adds a fixed offset to a value/paths.
- `transform:merge` — deep-merges additional objects into the message; each source is a literal object or a `${...}` template that resolves to one.
- `transform:munge` — rename/duplicate/remove/retain keys by path, with a `"*"` wildcard default.
- `transform:accumulate` — buffers messages, then forwards them as one array once `count` have arrived or the oldest has waited `maxAge`.
- `transform:aggregate` — collapses an array of samples into one value via `latest`/`average`/`sum`/`median`/`pX` (`src/util/aggregation.ts`).
- `transform:prettify` / `transform:uglify` — stringify the message as indented / compact JSON.
- `transform:shell` — runs a shell command (`command` or `codePath`), coerces stdout to `string`/`number`/`object`.
- `transform:javascript` — runs JS in a `node:vm` sandbox (`command` or `codePath`), same output coercion. The source is compiled once at registration into a function taking `message`, `stash`, `error`, `task`, `module`, and `env`; it must `return` its result, and it is not interpolated (`src/util/javascript.ts`).

**Controls** (`src/controls/`) — decide what the chain does next rather than changing the message:

- `control:return` — ends the chain and hands a value back to whatever invoked the task, plus any `stash` keys to publish into the caller's stash. A task that falls off its own end returns nothing. `cutie validate` warns about one in a task nothing invokes.
- `control:branch` — runs the task named by `task:` from inside this one, then carries on. The target decides what comes back exactly as a rescue does. The name is resolved per message, so a task may branch to one declared after it.
- `control:stop` — ends the chain here, so the steps after it never run. The message is consumed rather than failed, so it produces no `error` line and does not count as handled.
- `control:branch` and `control:stop` both take an optional `when`, a JavaScript function body compiled once at registration and read for truthiness. It means the same thing in both: when this holds, do what the module is named for. Omit it to do that every time, and note that a predicate that throws is an ordinary step failure rather than a false condition.

**Outputs** (`src/outputs/`):

- `output:console` — logs the message.
- `output:mqtt` — publishes to one or more (interpolated) MQTT topics.
- `output:file` — appends or overwrites a file (path interpolated, `encoding` configurable).
- `output:stash` — stores an interpolated value into the task's stash.
- `output:event` — emits the message on the in-process event bus.
- `output:logs` — routes a `{log, object, verbosity, topic}` message back into the logger; the sink side of `trigger:logs`.
- `output:influxdb` — writes a line-protocol point to InfluxDB via `connection:influxdb`.
- `output:nec` — transmits an NEC infrared remote command via `pigpio` bit-banging.
- `output:switchbots` — drives SwitchBot Bot devices (`on`/`off`/`press`) over BLE.
- `output:thermal-printer` — prints to a serial thermal printer, with a small markdown-heading dialect.
- `output:inky-phat` — draws each message on an Inky pHAT e-paper panel, 212x104 in three colours, from an image file or a bitmap the message carries.
- `output:unicorn-hat-mini` — draws each message on a Unicorn HAT Mini, a 17x7 grid of RGB LEDs, from the same two sources.

**Connections** (`src/connections/`):

- `connection:mqtt` — MQTT broker; also the one `ConfigProvider` implementation (retained-message config store), and it reference-counts subscriptions across triggers.
- `connection:influxdb` — InfluxDB v2 HTTP write endpoint; naming it as a config provider is rejected at fetch time (`src/util/Connection.ts:42-51`).

## Remote config over MQTT

A node can fetch its whole config from a connection at startup instead of reading a local file, keeping config for a fleet in one place instead of editing each machine over SSH (`README.md:82-84`).

- A local bootstrap config file with a `configProvider: { connectionName, topic }` block triggers this: cutie registers the connections declared in that local file, fetches the named connection's config for `topic`, tears the bootstrap connections down, and runs the fetched config's own `connections`/`tasks` instead (`src/util/configs.ts:46-69,145-164`).
- For MQTT specifically, `fetchConfig` subscribes to `topic` and resolves on the first (necessarily retained) message it receives, then disconnects — a one-shot fetch, not a persistent subscription (`src/connections/mqtt.ts:125-184`). It rejects on a timeout, and on a retained message that is not JSON, so a node whose config topic holds nothing still reaches the cache below.
- **No live reload.** A retained message published after a node has already booted isn't picked up until the process restarts — `src/connections/mqtt.ts:123-124` has two open `TODO`s for this. Publishing a new config is "edit, then restart the device," not hot-reload.
- **Local cache fallback.** On a successful remote fetch, cutie writes `<config>.cache.json` next to the local bootstrap file. If the remote fetch fails on a later boot, it falls back to that cache rather than failing to start (`src/util/configs.ts:98-143`).
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

## Provisioning a new Pi

`provisioner/` builds an SD card image, and splits the work in two. `provision.mjs` owns the **identity** configuration — user password, wifi, locale, SSH keys, and the services a headless Trixie host needs disabled — which is applied at image time and never re-applied to a running host, because getting one wrong strands an unreachable Pi. `configure-host.sh` owns the **convergent** configuration — bus enablement, swap, packages, Node, and the cutie service — and is idempotent, so it is safe to re-apply at any time (`README.md:19-24`, `provisioner/provision.mjs:16-20`).

1. Copy `provisioner/config.example.json` to `provisioner/config.json` (gitignored) and fill in `hostname`, `board`, `wifi.ssid`/`wifi.country`, `locale`, `sshPubKey` or `authorizedKeys`, `cutie.srcPath`/`cutie.destPath`, `cutieConfig`, and the `op://` references under `secrets`. `board` selects both the base image and the Node build: `pi-zero-w` takes the 32-bit armhf image, `pi-zero-2-w` and later take arm64, and an arm64 card will not boot a Pi Zero W (`README.md:296`).
2. Run `provision.mjs` on the operator machine, never on the Pi. Secrets are never read from disk — the caller resolves them into `CUTIE_PI_PASSWORD` and `CUTIE_WIFI_PSK`, which is what `cc-cred run` is for (`provisioner/provision.mjs:9-14`, `README.md:279-286`). It downloads and caches the base image, stages a per-host `cutie.conf.yaml` under its cache directory with `name` set to the hostname and `configProvider.topic` rewritten to `cutie/config/<hostname>` when the config declares an MQTT connection (`provisioner/provision.mjs:116-173`), then runs `sdm --customize` with the identity plugins plus `--cscript configure-host.sh` (`provisioner/provision.mjs:249-330`). `--dry-run` prints that invocation with the secrets masked, which is the quickest way to review the plugin list.
3. Burning is a separate, explicitly confirmed step: `node provisioner/provision.mjs --skip-customize --burn /dev/sdX`. It refuses to run without the device path retyped, or without `CUTIE_BURN_CONFIRM=/dev/sdX` when there is no terminal (`provisioner/provision.mjs:362-407`).
4. `configure-host.sh` runs `npm ci --omit=dev` during sdm's post-install phase, so a freshly burned card boots ready instead of compiling for 15-30 minutes on first use. The same script applies to an already-booted Pi through `provisioner/pi.sh <host> converge`.

The staged config is written under the provisioner's cache directory rather than into `config/`, so a run leaves the working tree clean. Board-specific findings for the Pi Zero W live in `.claude/docs/<node>-hardware.md`.

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
provisioner/pi.sh <node> deploy    # build locally, rsync built/, restart
provisioner/pi.sh <node> logs      # follow the journal, --namespace=cutie
provisioner/pi.sh <node> rollback  # swap the retained previous build back in
```

`deploy` never copies `node_modules`: native modules are compiled per architecture and per Node ABI, so a copy from a development machine lands unloadable binaries on the Pi. It also syncs `built/` and nothing else, so a build that imports a newly added runtime dependency starts and then dies at the import — sync `package.json` and `package-lock.json` to the device and run `npm install --omit=dev` there first (`.claude/docs/<node>-hardware.md:47-49`).

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
