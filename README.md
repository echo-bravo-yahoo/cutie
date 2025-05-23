# cutie

## What is this?

`cutie` is an application to make it easier to develop and glue together IoT & home automation applications. It primarily consists of three parts, all works-in-progress: a sensor platform, a system for reading from and writing to a remote data store (intended primarily as an MQTT listener/repeater), and a provisioning script that installs `cutie` on a raspberry pi. It aims to be configuration-first, with code extensions to support use cases the configuration cannot. I wrote [a little bit about the motivation behind it here](https://blog.echobravoyahoo.net/the-problem-with-home-automation-software/).

### `cutie` as a sensor platform

`cutie` can be used as a sensor platform for a limited number of sensors (BME280 and BME680 temperature sensors, BLE presence tracking). It's primarily intended for deployment to small, linux-based computers (e.g., raspberry pi). You can see a default config file at `./config/config.json`. Currently, the sensor platform supports:

- Sampling multiple times per reporting window
- Aggregating samples in various ways (avg, latest, p25/50/75/X)
- Offsetting values before publishing them
- Delivering data to one or multiple MQTT or InfluxDB exchanges

### `cutie` as an MQTT listener/repeater

This functionality is not implemented yet, but I plan to allow defining subscribe/transform/publish in config with the intent that users can integrate MQTT services that were not intended to be used together.

### `cutie` as a raspberry pi provisioner

This functionality is also not really implemented yet, but you can take a look at the work in progress in the `./provisioner` directory.

## Platform requirements

Right now, `cutie` is only tested to run on nodeJS 17 on 1st gen raspberry pi 0Ws. It should run in most linux environments, but individual sensors may fail to build or require OS utilities not present for some distributions. On ARMv6, it has to be built with python 3.10.8 or earlier.

## Installation & use

To use `cutie` as a CLI tool:

```bash
git clone git@github.com:echo-bravo-yahoo/cutie.git
cd cutie
npm install --python=python3.10 # won't build with newer python versions on ARMv6
npm link # optional, installs the CLI to your path as `cutie`
cutie
```

This starts `cutie` up using the config file present in `./config/config.json`. You'll need to customize it to fit your use-case. You can also pass a flag to the CLI to specify the location of a different config file, e.g., `cutie --config ~/my-config-file.json`. Config files can be JSON or YAML, with any extension.

Once you have it configured to your liking, you can install it to systemctl so it's run on startup and restarted on crash. First, modify `./config/cutie.service` to confirm that the `WorkingDirectory` and `user` fields are correct, then run `npm add-service`.

### To-do

- [x] Generalize transforms to work for either single or set operations
- [x] Normalize how sensors work compared to mqtt module
  - [ ] Normalize BLE sensor
- [x] Add interval / cron modules
- [x] Add temperature transformations
- [ ] Add cookbook for common tasks
- [ ] Move from using `./config/config-real.json` to `./config/config-sample.json` and having users copy.
- [ ] Support dynamic substitution in MQTT destination keys (everywhere?)
- [ ] Fix up logging
- [ ] Confirm full range of usable nodeJS versions (`engines` field in package.json)
- [ ] Build listen/repeat behavior
  - [x] Customizable data transformations
  - [x] Listen to topic pattern
  - [ ] Persistent queue vs transient queue
- [ ] Allow configuring `cutie` via MQTT
- [ ] Support other MQTT auth strategies
- [ ] Look for better sensor dependency management strategy
- [ ] Reimplement old `islands` sensors and outputs
  - [ ] infrared
  - [ ] NEC
  - [ ] switchbot
  - [ ] thermal-printer
- [ ] Document `exchanges` concept
- [ ] Document `outputs` concept
- [ ] Document `provisioner` concept
- [ ] Update `provisioner`
- [x] Update `Dockerfile`

### Common issues

#### `npm install` fails because of node-gyp failure

```
npm ERR! ValueError: invalid mode: 'rU' while trying to load binding.gyp
npm ERR! gyp ERR! configure error
npm ERR! gyp ERR! stack Error: `gyp` failed with exit code: 1
```

Ensure you're installing with python < 3.11, e.g., `npm install --python=python3.10 # or other older python that's on your PATH`.

### FAQ

#### What's with the name `cutie`?

If you say M**QT**T fast, it sounds like "em-cutie-tee". And software could stand to be a little cuter and more whimsical.

### Developing on `cutie`

These are primarily notes to myself for the time being.

#### Sensors

The `random` sensor runs without any hardware; use it to test changes to the runtime / behavior on your development box.

#### Logging

- Pretty logs: `npm run start -- --config ./config/config-real.json | pino-pretty`
- Pretty logs for only one tag (in this case, "shadow"): `npm run start -- --config ./config/config-real.json | jq 'select(.tags | index( "shadow" ))' | pino-pretty`

#### Deploying to a raspi for development

Problems with rsync: no watch daemon
`rsync --recursive --exclude "**/node_modules/*" --exclude "**/.git/*" --exclude "**/config.json"  --exclude "**.png" --exclude "**.zip" --exclude "**.md" --exclude "**/package-lock.json" ~/workspace/cutie/ <node>:/home/pi/cutie --verbose`

`git stash; git pull; git stash pop; sudo systemctl restart cutie; sudo journalctl -u cutie --follow`
