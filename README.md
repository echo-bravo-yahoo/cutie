# cutie

## What is this?

`cutie` is an application to make it easier to develop and glue together IoT & home automation applications. It primarily consists of three parts: a data transform & routing layer (intended primarily as an MQTT listener/repeater), a software sensor platform for linux computers, and a provisioning script that installs `cutie` on a raspberry pi. It aims to be configuration-first, with code extensions to support use cases the configuration cannot. I wrote [a little bit about the motivation behind it here](https://blog.echobravoyahoo.net/the-problem-with-home-automation-software/).

Every option every module accepts is listed in [the configuration reference](./docs/reference/README.md), which is generated from the schemas the runtime validates against. `cutie validate` checks a config file against those same schemas and reports everything wrong with it at once.

### `cutie` as a data transform & routing layer

`cutie` can listen to sensors or MQTT topics and transform the data or rebroadcast it to other MQTT topics or other data stores. This should enable users to integrate MQTT services that were not intended to be used together. Take a look at `./cookbook.md` for examples of how this functionality can be used.

### `cutie` as a sensor platform

`cutie` can be used as a sensor platform for a limited number of sensors (the BME280 and BME680, which read temperature, humidity, and barometric pressure -- plus gas resistance on the 680 -- and BLE presence tracking). It's primarily intended for deployment to small, linux-based computers (e.g., raspberry pi). Take a look at `./sensors.md` for an overview of currently supported sensors and how you can configure them. Every step module also carries an example config in a comment at the bottom of its own file, so `src/triggers/`, `src/reads/`, and `src/outputs/` are the current list of what is supported.

### `cutie` as a raspberry pi provisioner

The `./provisioner` directory holds two halves of the same host definition:

- `provision.mjs` builds an SD card image with [sdm](https://github.com/gitbls/sdm) and optionally burns it. It owns the **identity** configuration only -- user password, wifi, locale, SSH keys, and the services a headless Trixie host needs disabled. Getting any of these wrong strands an unreachable Pi, so they are applied at image time and never re-applied to a running host.
- `configure-host.sh` holds the **convergent** configuration -- bus enablement, swap, packages, Node, and the `cutie` service. It is idempotent, so it is safe to re-apply at any time. `provision.mjs` hands it to sdm via `--cscript`, and `pi.sh converge` pipes the same script to a booted Pi over SSH.

That split means routine reconfiguration is a few seconds over SSH rather than a reburn, and a routine convergence run cannot break SSH reachability.

## Platform requirements

`cutie` needs nodeJS 22.x.x. It should run in most linux environments, but individual sensors may fail to build or require OS utilities not present for some distributions.

The upper bound is a hardware constraint rather than a preference. Node 22 (EOL 2027-04-30) is the last major with any 32-bit ARM build at all: neither the official dist nor unofficial-builds produces an `armv6l` or `armv7l` tarball for Node 24 or 26, and `BUILDING.md` downgraded armv7 to _Experimental_ as of Node 24. ARMv6 is 32-bit-only silicon, so a Pi Zero W can never move to arm64 and is pinned to Node 22 permanently. Newer boards (Pi Zero 2 W and up) take the arm64 image, where Node is a Tier 1 platform and this ceiling does not apply.

## Installation & use

To use `cutie` as a CLI tool:

```bash
npm install --global @echobravoyahoo/cutie
cutie init      # writes a starter cutie.conf.yaml to the current directory
cutie validate  # reports anything wrong with it
cutie           # runs it
```

### Commands and options

| Command          | What it does                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| `cutie start`    | run the tasks in the config file; the default when no command is given         |
| `cutie validate` | check the config file and report every problem found, without running anything |
| `cutie init`     | write a starter config file to the current directory                           |
| `cutie upload`   | publish local config files to a connection                                     |
| `cutie download` | fetch config files from a connection                                           |

| Option                | Meaning                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `--config <path>`     | config file to use; defaults to `cutie.conf.yaml` in the working directory                      |
| `--log-level <level>` | lowest level to log: `trace`, `debug`, `info`, `warn`, `error`, or `fatal`; defaults to `debug` |
| `--help`              | usage for the command, or for `cutie` itself when no command is given                           |
| `--version`           | the installed version                                                                           |

An unrecognized option is an error rather than a silently ignored argument, and the message suggests the closest real one.

### Using `cutie` as a library

The package publishes `main` and `types`, so a node program can drive the runtime directly instead of through the CLI:

```javascript
import { start } from "@echobravoyahoo/cutie";

// resolves once every connection and task in the config has registered, and
// rejects rather than starting anything if the config does not validate
const globals = await start({ _: [], config: "./cutie.conf.yaml" });

console.log(globals.tasks.map((task) => task.name));
```

`start` returns the runtime's globals: the registered `tasks`, the open `connections`, the `logger`, and the internal `eventBus`. There is no separate stop function yet; send the process `SIGTERM` and the shutdown path disables every task and connection.

### The default config

The config `cutie init` copies publishes a heartbeat and cutie's own logs to MQTT once a minute. Edit the `broker` connection's `endpoint`, `username`, and `password` in `cutie.conf.yaml` before relying on this -- left unedited, cutie logs one error at startup for the unreachable broker and then runs normally without publishing; restart cutie after fixing the connection to pick it back up.

### Managing config for a fleet

Once more than one machine runs `cutie`, editing each machine's config file over SSH stops scaling. `cutie` can instead keep config files on a connection -- today, as retained MQTT messages -- so a node fetches its own config at startup and you edit them all from one place. See `./examples/remote-config.yaml` for the node side.

Two subcommands manage those stored configs:

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

| Flag               | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `--config`         | the local config file naming the connection to use (not the config being uploaded)      |
| `--connectionName` | which connection in that file to talk to                                                |
| `--path`           | directory to read from or write to; a single file when combined with `--node` on upload |
| `--node`           | operate on one node instead of all of them                                              |
| `--topic`          | override where configs are stored; defaults to `cutie/config/+`                         |

Uploaded files can be JSON, YAML, or YML, and the node name is taken from the filename. Downloaded files are always written as `<node>.conf.json`, and upload strips both the extension and a trailing `.conf` back off, so a fleet downloaded into a directory and uploaded again goes back to the topics it came from.

`--topic` is a single value that works for every combination of these flags, because a `+` segment stands in for the node name. `--topic 'fleet/config/+'` subscribes to `fleet/config/+` when downloading everything, and publishes to `fleet/config/kitchen-pi` when uploading that node.

### Mental model for using `cutie`

There are not very many parts to a `cutie` installation, but they look like this:

- A linux computer (optionally with some sensors attached)
  - With `cutie` installed (optionally installed as a systemd service)
    - With a config file consisting of:
      - Connection configs, which define what data stores `cutie` can reach and what information it needs to reach them. To actually use a Connection, you'll need a Connection config and an Trigger or Output config - the Connection config contains the settings required to reach the data store at all, and the Trigger/Output configs contain the settings for that particular task.
      - Tasks, a description of one 'trigger, transform, output' pipeline. This usually represents some discrete sensor or task and contains Trigger, Transform, and Output configs.
        - Trigger configs, which define what remote data sources and local sensors `cutie` should watch for changes in.
        - Transform configs, which define how `cutie` should transform Messages after an Trigger but before an Output.
        - Output configs, which define destinations for cutie to send data to. These can be intermediate or final destinations.

### Hardware dependencies are optional

Every package that talks to hardware -- `bme280`, `bme680-sensor`, `inkyphat`, `node-ble`, `node-switchbot`, `onoff`, `pi-spi`, `pigpio`, `serialport`, and `thermalprinter` -- is an `optionalDependency`. Most are native builds needing python and a C++ toolchain, so on a machine without one, `npm install` skips them and succeeds rather than failing outright.

Nothing is lost until a config asks for that hardware. Each module loads its package when the step is enabled, so a node running only MQTT and transform steps never touches them. A config that does ask for absent hardware fails at startup naming the package:

```
read:bme280 needs the optional "bme280" package, which is not installed or
failed to build. Install build tools and re-run npm install.
```

Every hardware-backed step also takes `virtual: true`, which skips the hardware and needs none of these packages installed. A sensor fakes plausible readings; a display still loads, scales and quantises its source, then logs what it would have drawn. See [sensors.md](./sensors.md).

### Common issues

#### `npm install` fails because of node-gyp failure

```
npm ERR! ValueError: invalid mode: 'rU' while trying to load binding.gyp
npm ERR! gyp ERR! configure error
npm ERR! gyp ERR! stack Error: `gyp` failed with exit code: 1
```

This is an old node-gyp meeting a newer python. node-gyp 10 and later handle python 3.12; `package.json` pins `"node-gyp": "^11.0.0"` in `overrides` so every native dependency uses a version that does. If the error still appears, a dependency is pulling its own older node-gyp -- check `npm ls node-gyp`.

There is no upper bound on the python version to worry about. On ARMv6 with python 3.11.2, native modules compile cleanly.

#### `ERR_DLOPEN_FAILED ... wrong ELF class: ELFCLASS64`

A native module was compiled for a different architecture than the one loading it -- typically the result of copying `node_modules` onto a Pi from a 64-bit machine. Native modules are never portable across architectures or across Node ABI versions.

Delete `node_modules` on the Pi and run `provisioner/pi.sh <host> install`, which does a clean `npm ci --omit=dev` on the device. Four dependencies compile from source (`i2c-bus`, `pigpio`, `usocket`, `deasync`), and `i2c-bus` alone takes about three minutes on a Pi Zero W.

A freshly imaged card should not need this: `configure-host.sh` builds dependencies during the image build, inside sdm's emulated container, so the card boots ready. node-gyp reads the architecture from the running Node binary rather than from `uname`, so the emulated build still produces ARMv6 objects.

#### `npm ci` on an ARMv6 Pi fails with `SIGILL` in esbuild's postinstall

```
> esbuild@0.25.6 postinstall
> node install.js
Error: Command failed: node_modules/esbuild/bin/esbuild --version
  signal: 'SIGILL'
```

Use `--omit=dev`. esbuild's `linux-arm` prebuild is compiled for ARMv7, so the binary hits an illegal instruction on the ARMv6 Pi Zero W before it can print its version. It arrives via `tsx`, which is a devDependency.

A Pi never needs the dev tooling: `npm run start:prod` executes `./built/cli-entrypoint.js` directly under node, with no TypeScript in the loop. Omitting dev dependencies is both the fix and considerably faster.

### FAQ

#### What's with the name `cutie`?

If you say M**QT**T fast, it sounds like "em-cutie-tee". And software could stand to be a little cuter and more whimsical. Oh, and as an added benefit, if you run `cutie` on a raspberry pi, you have a `cutie pi`!

### Developing on `cutie`

These are primarily notes to myself for the time being.

#### Installing for development

```bash
git clone git@github.com:echo-bravo-yahoo/cutie.git
cd cutie
npm install
npm link # optional, installs the CLI to your path as `cutie`
cutie
```

This starts `cutie` up using the config file present at `./cutie.conf.yaml` -- the default is always `cutie.conf.yaml` in the current working directory. You'll need to customize it to fit your use-case. You can also pass a flag to the CLI to specify the location of a different config file, e.g., `cutie --config ~/my-config-file.json`. Config files can be JSON or YAML, with any extension.

Once you have it configured to your liking, you can install it to systemctl so it's run on startup and restarted on crash. First, modify `./config/cutie.service` to confirm that the `WorkingDirectory` and `User` fields are correct, then run `npm run add-service`.

#### Sensors

`read:random` produces a number that drifts within bounds, one step at a time, with no hardware attached. Put it where a real sensor's read would go and the rest of the task behaves the same, which makes it the way to test runtime changes on a development box.

#### Config paths

Every relative path a config contains -- a `read:file` path, an `output:file` path, a `codePath` -- resolves against the directory holding the config file, not against the working directory the process was started from. Moving a config moves everything it refers to with it.

#### Logging

- Logs are written as colorized text by `pino-pretty`, not as JSON, so they are meant to be read rather than piped through `jq`.
- `--log-level` sets the lowest level that reaches the console. Everything a module logs goes there, not just what `output:console` prints.
- To filter logs by subsystem, use a `trigger:logs` task instead. It receives every internal log line and matches the line's topic against its `filters`, where `*` is a wildcard and a leading `!` negates. The last matching filter wins, so `["*", "!core.registration.*"]` means "everything except registration". It only sees lines at `warn` or above unless you lower its `minVerbosity`, and `maxVerbosity` adds a ceiling, so two tasks can split the same topics by severity rather than both seeing the severe lines.
- A `trigger:logs` task never sees its own subtree's lines, and a line produced while a line is being dispatched still reaches the console but starts no second dispatch. Between them, those two rules are what stop a logs task feeding an output that logs from feeding itself forever.
- A connection that fails to register (e.g. an unreachable broker) always prints directly, and still reaches a `trigger:logs` task even though connections register before tasks: every line the node writes while no logs task is listening yet is held, at every level, and replayed to each logs task as it registers. The window closes when registration ends, so a config with no logs task holds nothing.
- The systemd service logs to a dedicated journal namespace (`LogNamespace=cutie` in `./config/cutie.service`), capped at 50M total / 10M per file by `./config/cutie.journald.conf`, so a runaway log can't fill up the SD card. A plain `journalctl -u cutie` won't show anything for the deployed service -- add `--namespace=cutie`, as below.

##### Errors

A step that throws does not take the node down with it, and never took the rest of the config with it either.

- The step logs the failure under its own topic, at `error`, with the message's trace ID and a structured object naming the task, the step, the module type, and the error. That is enough to route on without parsing log text.
- The trigger then abandons the message and logs one line saying so. The task stays enabled and the next message runs; every other task is untouched.
- A task that fails to register is skipped and reported under `core.registration.tasks`, and the rest of the config registers. A config whose every task fails to register refuses to start.
- Add `rescue: "<task name>"` to a step -- or to a task, as the default for its steps -- to say what should happen instead. The named task is handed the message that failed and an `${error...}` namespace (`${error.message}`, `${error.name}`, `${error.task}`, `${error.step}`, `${error.type}`), and works on a deep copy of the failing message's stash. If it ends at a `control:return`, the value that step names replaces the message and the chain carries on; if it falls off its own end, the message ends there. A rescue naming a task the config does not declare, or one that leads back to the task it rescues, is refused by `cutie validate`.
- `output:inky-phat` and `output:st7735` no longer swallow a failed draw. A `rescue` whose only step is a bare `control:return` restores the old behaviour: it hands the message straight back, so the chain carries on as if the draw had worked.
- Routing errors somewhere of their own is a pair of `trigger:logs` tasks: `minVerbosity: "error"` on the one that alerts, and `minVerbosity: "info"` with `maxVerbosity: "warn"` on the one that keeps the ordinary log. Without the ceiling an error lands in both. See the "routing a failing step" recipe in [cookbook.md](./cookbook.md).

##### Tracing

Every message gets a uuid v7 trace ID when it starts, and every log line that message produces -- the trigger's, each step's, each step's duration, and the task's total -- ends with that ID in parentheses. Grep for one ID to see everything a single reading did.

- A log line inherits the trace of the message that produced it, so a task driven by `trigger:logs` runs its own steps under the trace of the line it received rather than starting an unrelated one. That task's own log lines are never fed back into it, since a log bus that echoed them would loop forever.
- Trace IDs only reach a sink when a `trigger:logs` task is configured. Module log lines go to the internal log bus, not to the console, so without such a task there is nothing to read them in.
- A trace crosses the internal event bus (`output:event` to `trigger:event`) on its own. Crossing MQTT is opt-in: set `propagateTrace: true` on the `output:mqtt` step and `protocolVersion: 5` on its connection. The ID travels as a W3C `traceparent` MQTT user property, which only exists in MQTT v5 and which mqtt.js does not speak unless the connection asks for it; the payload is untouched, so other subscribers see no change. `examples/remote-clock.yaml` wires up both halves.

#### Deploying to a raspi for development

`./provisioner/pi.sh <host> <verb>` drives a Pi over SSH from a development machine. An ARMv6 board is too constrained to develop on directly, so work happens on a workstation and reaches the Pi through this script.

| Verb       | What it does                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `probe`    | Report kernel, Node, buses, service state, and detected I2C addresses                                                                                                                      |
| `deploy`   | Build locally, rsync `built/` to the Pi, keep the previous build, restart                                                                                                                  |
| `install`  | Clean on-device `npm ci --omit=dev`, run detached so an SSH drop can't kill it. Rarely needed: images build their own dependencies, and `converge` installs them when the lockfile changes |
| `rollback` | Swap the retained previous build back in and restart                                                                                                                                       |
| `restart`  | Restart the service                                                                                                                                                                        |
| `status`   | `systemctl status` for the service                                                                                                                                                         |
| `logs`     | Follow the service journal (`--namespace=cutie`)                                                                                                                                           |
| `converge` | Pipe `configure-host.sh` to the Pi and apply it                                                                                                                                            |

`deploy` never copies `node_modules`. Native modules are compiled per architecture and per Node ABI, so a copy from a development machine lands unloadable binaries on the Pi -- run `npm ci` on the device instead.

Because `cutie.service` sets `Restart=always`, a broken deploy becomes a crash loop, which is what `rollback` exists for.

#### Building an SD card image

Install sdm and repair the ARM binfmt registration on the build host once, then:

```bash
cp provisioner/config.example.json provisioner/config.json   # edit hostname, board, wifi, op:// refs
cc-cred run CUTIE_PI_PASSWORD=op://<vault>/<item>/password \
            CUTIE_WIFI_PSK=op://<vault>/<item>/password \
            -- node provisioner/provision.mjs
```

That customizes and shrinks an image without touching any device. `--dry-run` prints the sdm invocation with the secrets masked, which is the quickest way to review the plugin list. Burning is a separate, explicitly confirmed step:

```bash
node provisioner/provision.mjs --skip-customize --burn /dev/sdX
```

It refuses to run without retyping the device path, or without `CUTIE_BURN_CONFIRM=/dev/sdX` when there is no terminal.

`board` in `provisioner/config.json` selects both the base image and the Node build. `pi-zero-w` takes the 32-bit armhf image; `pi-zero-2-w` and later take arm64. An arm64 card will not boot a Pi Zero W.

On WSL2, expose the card reader with `usbipd bind --busid <id>` followed by `usbipd attach --wsl --busid <id>` from an elevated PowerShell. The bind persists across reboots; the attach does not.

#### Releasing

Releases are cut from `main` only, and only by pushing a version tag:

```bash
git checkout main
git pull
npm version <patch|minor|major|prerelease> # bumps package.json, commits, and tags locally
git push origin main --follow-tags
```

The `Publish` GitHub Actions workflow picks up the pushed tag, runs the test suite, publishes to npm via OIDC trusted publishing (no token involved), and creates a matching GitHub release. The npm dist-tag is derived from the version string -- a plain version (e.g. `4.0.1`) publishes as `latest`, while a prerelease version (e.g. `4.0.1-alpha.0`) publishes under its prerelease identifier (e.g. `alpha`) so it never overwrites `latest`.
