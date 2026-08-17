# Running cutie

How to install, configure, test, provision, and deploy `cutie`. For why it's built this way, see `.claude/docs/design-principles.md`.

## Quick start

```bash
npm install --global @echobravoyahoo/cutie
cutie init    # writes a starter config file in the current directory
cutie         # runs cutie using ./cutie.conf.json
```

Node 22-24 is required (`package.json:42`). On ARMv6, native deps need Python <=3.10.8 (`PYTHON="$(which python3.10)" npm install`).

## Local development

```bash
git clone git@github.com:echo-bravo-yahoo/cutie.git
cd cutie
npm install --python=python3.10   # won't build with newer python on ARMv6
npm link                          # optional: installs the `cutie` CLI to PATH
npm start                         # runs against ./cutie.conf.json
```

`npm start` is `npx tsx ./src/cli-entrypoint.ts start` — it runs TypeScript directly via `tsx`, no build step needed for local iteration. `npm run build` (`tsc`, then chmods the built entrypoint) produces `./built/cli-entrypoint.js`, which is what the systemd service and Docker image actually run.

The `random` sensor (`trigger:random`/`read:random`) needs no hardware — use it to exercise a new transform or output chain on a dev machine (`sensors.md:46-73`).

## CLI reference

Entry point: `src/cli-entrypoint.ts`. Global flag `--config <path>` (default `./cutie.conf.json`) selects the config file; config files can be JSON or YAML with any extension.

- `cutie` / `cutie start` — run the tasks in the config file (default subcommand).
- `cutie init` — write a starter config file to the current directory; refuses to overwrite an existing one.
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

Type string is `<kind>:<subKind>`, and loads `src/<kind>s/<subKind>.ts` (see design-principles.md). This is `main`'s inventory as of 2026-08-17; a given fleet device may run an older or feature-branch ref — see `~/.claude/docs/cutie-fleet.md`.

**Triggers** (`src/triggers/`) — start a task:

- `trigger:once` — fires one (optionally delayed, interpolated) message, then stops.
- `trigger:repeat` — fires a fixed message on a fixed interval.
- `trigger:cron` — fires a fixed message on a cron schedule.
- `trigger:mqtt` — starts a task when a message arrives on a subscribed MQTT topic.
- `trigger:event` — starts a task when the in-process event bus emits a key.
- `trigger:file-change` — starts a task on filesystem change events.
- `trigger:logs` — starts a task for internal log lines matching `filters` (`*` wildcard, `!` negates, last match wins).
- `trigger:infrared` — GPIO IR receiver; emits raw `{level, tick}` edges (decoding is left to downstream steps).
- `trigger:random` (a `Sensor`) — software numeric walk, no hardware.
- `trigger:ble-tracker` (a `Sensor`) — BLE presence/RSSI tracking for named devices.

**Reads** (`src/reads/`) — replace the message with a fresh reading; pair with a trigger like `trigger:repeat`:

- `read:bme280` — temperature/humidity/pressure over I2C.
- `read:bme680` — BME280 fields plus gas-resistance (VOC).
- `read:random` — numeric walk, no hardware.
- `read:constant` — replaces the message with a fixed, interpolated literal.
- `read:stash` — replaces the message with a value from the task's stash.
- `read:file` — replaces the message with a file's contents (path interpolated, `encoding` configurable).

**Transforms** (`src/transforms/`):

- `transform:round` — rounds a numeric value/paths to a precision (up/down/round).
- `transform:convert` — unit conversion (currently celsius<->fahrenheit only).
- `transform:offset` — adds a fixed offset to a value/paths.
- `transform:merge` — deep-merges additional objects (literal or `$$`-interpolated) into the message.
- `transform:munge` — rename/duplicate/remove/retain keys by path, with a `"*"` wildcard default.
- `transform:accumulate` — buffers N messages, then forwards them as a batch array.
- `transform:aggregate` — collapses an array of samples into one value (same aggregations as `Sensor.doAggregation`).
- `transform:prettify` / `transform:uglify` — stringify the message as indented / compact JSON.
- `transform:shell` — runs a shell command (`command` or `codePath`), coerces stdout to `string`/`number`/`object`.
- `transform:javascript` — runs JS in a `node:vm` sandbox (`command` or `codePath`), same output coercion.

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

**Connections** (`src/connections/`):

- `connection:mqtt` — MQTT broker; also serves as a config provider (retained-message config store) and reference-counts subscriptions across triggers.
- `connection:influxdb` — InfluxDB v2 HTTP write endpoint; cannot be used as a config provider.

## Remote config over MQTT

A node can fetch its whole config from a connection at startup instead of reading a local file, keeping config for a fleet in one place instead of editing each machine over SSH (`README.md:33-35`).

- A local bootstrap config file with a `configProvider: { connectionName, topic }` block triggers this: cutie registers the connections declared in that local file, fetches the named connection's config for `topic`, tears the bootstrap connections down, and runs the fetched config's own `connections`/`tasks` instead (`src/util/configs.ts:28-101`).
- For MQTT specifically, `fetchConfig` subscribes to `topic` and resolves on the first (necessarily retained) message it receives, then disconnects — a one-shot fetch, not a persistent subscription (`src/connections/mqtt.ts:117-147`).
- **No live reload.** A retained message published after a node has already booted isn't picked up until the process restarts — `src/connections/mqtt.ts:115-116` has two open `TODO`s for this. Publishing a new config is "edit, then restart the device," not hot-reload.
- **Local cache fallback.** On a successful remote fetch, cutie writes `<config>.cache.json` next to the local bootstrap file. If the remote fetch fails on a later boot, it falls back to that cache rather than failing to start (`src/util/configs.ts:49-80`).
- Example: `examples/remote-config.yaml`.

Two subcommands manage the stored configs (also see `README.md:37-63`):

```bash
# publish every config file in a directory, one per file, recursively
cutie upload --config ./cutie.conf.json --connectionName my-broker --path ./fleet-configs

# publish just one, naming the node it belongs to
cutie upload --config ./cutie.conf.json --connectionName my-broker --path ./fleet-configs/kitchen-pi.yaml --node kitchen-pi

# fetch every stored config into a directory
cutie download --config ./cutie.conf.json --connectionName my-broker --path ./fleet-configs

# fetch just one
cutie download --config ./cutie.conf.json --connectionName my-broker --node kitchen-pi --path ./fleet-configs
```

`--topic` defaults to `cutie/config/+`; the `+` segment stands in for the node name on both subscribe (download) and publish (upload). This substitution is a fleet-CLI-only convenience — a device's own `configProvider.topic` (the topic it fetches at boot) must be a literal string, not a `+` template.

For administering the actual live fleet (which devices exist, their topics, reading current config off the broker), see the global `~/.claude/docs/cutie-admin.md` and `~/.claude/docs/cutie-fleet.md`.

## Provisioning a new Pi

`provisioner/` images an SD card for a new device (README calls this "not really implemented yet," `README.md:17` — verify that caveat is still accurate before relying on it).

1. Copy `provisioner/config.example.json` to `provisioner/config.json` (gitignored) and fill in `arch`, `hostname`, `imageUrl`, `nodeVersion`, `password`, `wifi.ssid`/`wifi.password`, `files`, and `cutie.srcPath`/`cutie.destPath`.
2. Run `provisioner/provision.mjs` on the operator machine (not the Pi). It writes `hostname` into `config/cutie.conf.json`'s `name` field, and — only if that file already declares `configProvider.connectionName` — rewrites `configProvider.topic` to `cutie/config/<hostname>` (`provisioner/provision.mjs:35-46`). It then downloads/caches a Node ARM build and the Raspberry Pi OS Lite base image, and uses `sdm --customize` to set credentials, rsync the whole repo onto the image (excluding paths in `provisioner/rsync-exclude.txt`), install `git`/`i2c-tools`/`pigpio`, add swap, enable i2c/serial, and stage `install-node.sh` to run at first boot.
3. `provision.mjs` burns the image to the device named by the `cutie_provisioner_device` env var (e.g. `/dev/sde`) via `sdm --burn`.
4. On first boot, `install-node.sh` symlinks node/npm/npx onto `PATH`, then runs `npm run add-service` in the synced repo.

This rewrites `config/cutie.conf.json` in the working tree — expect `provision.mjs` to leave that file dirty after a run (comment, `provisioner/provision.mjs:32-34`).

## Running as a systemd service

- `npm run add-service` — copies `config/cutie.service` to `/etc/systemd/system/cutie.service` and `config/cutie.journald.conf` to `/etc/systemd/journald@cutie.conf`, reloads systemd, enables the unit.
- `npm run update-service` — the same, plus restarts both the service and its journald namespace. Use this to pick up a new build on an already-provisioned host.
- The shipped `config/cutie.service` runs `User=pi`, `ExecStart=/usr/bin/env npm run start:prod` (`npm run start:prod` is `./built/cli-entrypoint.js start --config ./config/cutie.conf.json`), `Restart=always`, `RestartSec=2`. `WorkingDirectory` and node's install path vary per host — the comment in the file says so explicitly; treat it as a template each host's live unit is hand-maintained from, not a synced source of truth.
- `LogNamespace=cutie` routes logs to a dedicated journal namespace, capped at 50M total / 10M per file by `config/cutie.journald.conf`. `journalctl -u cutie` alone shows nothing for the deployed service — add `--namespace=cutie`.

## Docker

`Dockerfile` builds from `node:22-slim`, installs the toolchain needed for native modules, runs `npm ci && npm run build`, and defaults `CMD` to the same bare starter config the systemd path uses unless a real config is mounted over it. `npm run build:docker` / `build:docker:wsl` build the image. No `docker-compose.yml` exists, and neither GitHub Actions workflow touches Docker — this is a secondary/dev-convenience path, not the one actually exercised for the fleet (that's the Pi-image route via `provisioner/`, and code deploys via `cutie-deploy.sh` — see `~/.claude/docs/cutie-admin.md`).

## Deploying code to an existing device

Manual dev-loop version (`README.md:141-145`):

```bash
rsync --recursive --exclude "**/node_modules/*" --exclude "**/.git/*" --exclude "**/config.json" --exclude "**.png" --exclude "**.zip" --exclude "**.md" --exclude "**/package-lock.json" ~/workspace/cutie/ kitchen-pi:/home/pi/cutie --verbose
# on the pi:
git stash; git pull; git stash pop; sudo systemctl restart cutie; sudo journalctl -u cutie --namespace=cutie --follow
```

For the real fleet, `~/.aeby/scripts/cutie-deploy.sh [--ref <git-ref>] [host ...]` automates this over SSH, verifies the service comes back healthy, and is documented in `~/.claude/docs/cutie-admin.md`. This is a **code** deploy (git ref based) — distinct from the MQTT retained-config mechanism above, which changes a device's runtime _config_ without touching its code.

## Testing

`npm test` runs `test/**/*.ts` via `tsx --test`. Suites: `test/unit/cli.ts` (upload/download), `test/unit/examples.ts` (runs the example configs end-to-end, including `remote-config.yaml` against a mocked broker), `test/unit/runtime.ts`, `test/unit/string-interpolation.ts`, `test/unit/transformations.ts`, `test/unit/triggers.ts`. `test/helpers.ts` has shared mocks/fixtures. Use `npm run test:coverage` for a coverage report, `npm run test:watch` while iterating.

## Releasing

Releases are cut from `main` only, by pushing a version tag:

```bash
git checkout main
git pull
npm version <patch|minor|major|prerelease>
git push origin main --follow-tags
```

The `Publish` GitHub Actions workflow runs the test suite, publishes to npm via OIDC trusted publishing, and creates a matching GitHub release. A plain version publishes as the `latest` dist-tag; a prerelease version publishes under its own prerelease identifier.