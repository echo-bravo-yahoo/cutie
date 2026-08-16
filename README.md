# cutie

## What is this?

`cutie` is an application to make it easier to develop and glue together IoT & home automation applications. It primarily consists of three parts: a data transform & routing layer (intended primarily as an MQTT listener/repeater), a software sensor platform for linux computers, and a provisioning script that installs `cutie` on a raspberry pi. It aims to be configuration-first, with code extensions to support use cases the configuration cannot. I wrote [a little bit about the motivation behind it here](https://blog.echobravoyahoo.net/the-problem-with-home-automation-software/).

### `cutie` as a data transform & routing layer

`cutie` can listen to sensors or MQTT topics and transform the data or rebroadcast it to other MQTT topics or other data stores. This should enable users to integrate MQTT services that were not intended to be used together. Take a look at `./cookbook.md` for examples of how this functionality can be used.

### `cutie` as a sensor platform

`cutie` can be used as a sensor platform for a limited number of sensors (the BME280 and BME680, which read temperature, humidity, and barometric pressure -- plus gas resistance on the 680 -- and BLE presence tracking). It's primarily intended for deployment to small, linux-based computers (e.g., raspberry pi). Take a look at `./sensors.md` for an overview of currently supported sensors and how you can configure them.

### `cutie` as a raspberry pi provisioner

This functionality is also not really implemented yet, but you can take a look at the work in progress in the `./provisioner` directory.

## Platform requirements

Right now, `cutie` should run on any nodeJS environment between 22.x.x - 24.x.x. My personal installation uses nodeJS 22 on 1st gen raspberry pi 0Ws. It should run in most linux environments, but individual sensors may fail to build or require OS utilities not present for some distributions. On ARMv6, it has to be built with python 3.10.8 or earlier.

## Installation & use

To use `cutie` as a CLI tool:

```bash
npm install --global @echobravoyahoo/cutie
cutie init # this creates a default/blank config file in your current directory
cutie # this runs cutie using the config file in the current directory
```

### Managing config for a fleet

Once more than one machine runs `cutie`, editing each machine's config file over SSH stops scaling. `cutie` can instead keep config files on a connection -- today, as retained MQTT messages -- so a node fetches its own config at startup and you edit them all from one place. See `./examples/remote-config.yaml` for the node side.

Two subcommands manage those stored configs:

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

| Flag | Meaning |
| --- | --- |
| `--config` | the local config file naming the connection to use (not the config being uploaded) |
| `--connectionName` | which connection in that file to talk to |
| `--path` | directory to read from or write to; a single file when combined with `--node` on upload |
| `--node` | operate on one node instead of all of them |
| `--topic` | override where configs are stored; defaults to `cutie/config/+` |

Uploaded files can be JSON, YAML, or YML, and the node name is taken from the filename. Downloaded files are always written as `<node>.conf.json`.

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

Every package that talks to hardware -- `bme280`, `bme680-sensor`, `node-ble`, `node-switchbot`, `pigpio`, `serialport`, and `thermalprinter` -- is an `optionalDependency`. All but `thermalprinter` are native builds needing python and a C++ toolchain, so on a machine without one, `npm install` skips them and succeeds rather than failing outright.

Nothing is lost until a config asks for that hardware. Each module loads its package when the step is enabled, so a node running only MQTT and transform steps never touches them. A config that does ask for absent hardware fails at startup naming the package:

```
read:bme280 needs the optional "bme280" package, which is not installed or
failed to build. Install build tools and re-run npm install.
```

### Common issues

#### `npm install` fails because of node-gyp failure

```
npm ERR! ValueError: invalid mode: 'rU' while trying to load binding.gyp
npm ERR! gyp ERR! configure error
npm ERR! gyp ERR! stack Error: `gyp` failed with exit code: 1
```

Ensure you're installing with python < 3.11, e.g., `PYTHON="$(which python3.10)" npm install # or other older python that's on your PATH`. To install python 3.10 on ubuntu systems:

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.10 python3.10-venv python3.10-dev
```

### FAQ

#### What's with the name `cutie`?

If you say M**QT**T fast, it sounds like "em-cutie-tee". And software could stand to be a little cuter and more whimsical. Oh, and as an added benefit, if you run `cutie` on a raspberry pi, you have a `cutie pi`!

### Developing on `cutie`

These are primarily notes to myself for the time being.

#### Installing for development

```bash
git clone git@github.com:echo-bravo-yahoo/cutie.git
cd cutie
npm install --python=python3.10 # won't build with newer python versions on ARMv6
npm link # optional, installs the CLI to your path as `cutie`
cutie
```

This starts `cutie` up using the config file present at `./cutie.conf.json` -- the default is always `cutie.conf.json` in the current working directory. You'll need to customize it to fit your use-case. You can also pass a flag to the CLI to specify the location of a different config file, e.g., `cutie --config ~/my-config-file.json`. Config files can be JSON or YAML, with any extension.

Once you have it configured to your liking, you can install it to systemctl so it's run on startup and restarted on crash. First, modify `./config/cutie.service` to confirm that the `WorkingDirectory` and `User` fields are correct, then run `npm run add-service`.

#### Sensors

The `random` sensor runs without any hardware; use it to test changes to the runtime / behavior on your development box.

#### Logging

- Logs are written as colorized text by `pino-pretty`, not as JSON, so they are meant to be read rather than piped through `jq`.
- To filter logs by subsystem, use a `trigger:logs` task instead. It receives every internal log line and matches the line's topic against its `filters`, where `*` is a wildcard and a leading `!` negates. The last matching filter wins, so `["*", "!core.registration.*"]` means "everything except registration".
- A connection that fails to register (e.g. an unreachable broker) always prints directly, in addition to being available to a `trigger:logs` task -- connections register before tasks, so no `trigger:logs` task can be listening yet when that failure happens.
- The systemd service logs to a dedicated journal namespace (`LogNamespace=cutie` in `./config/cutie.service`), capped at 50M total / 10M per file by `./config/cutie.journald.conf`, so a runaway log can't fill up the SD card. A plain `journalctl -u cutie` won't show anything for the deployed service -- add `--namespace=cutie`, as below.

#### Deploying to a raspi for development

Problems with rsync: no watch daemon `rsync --recursive --exclude "**/node_modules/*" --exclude "**/.git/*" --exclude "**/config.json"  --exclude "**.png" --exclude "**.zip" --exclude "**.md" --exclude "**/package-lock.json" ~/workspace/cutie/ kitchen-pi:/home/pi/cutie --verbose`

`git stash; git pull; git stash pop; sudo systemctl restart cutie; sudo journalctl -u cutie --namespace=cutie --follow`

#### Releasing

Releases are cut from `main` only, and only by pushing a version tag:

```bash
git checkout main
git pull
npm version <patch|minor|major|prerelease> # bumps package.json, commits, and tags locally
git push origin main --follow-tags
```

The `Publish` GitHub Actions workflow picks up the pushed tag, runs the test suite, publishes to npm via OIDC trusted publishing (no token involved), and creates a matching GitHub release. The npm dist-tag is derived from the version string -- a plain version (e.g. `4.0.1`) publishes as `latest`, while a prerelease version (e.g. `4.0.1-alpha.0`) publishes under its prerelease identifier (e.g. `alpha`) so it never overwrites `latest`.
