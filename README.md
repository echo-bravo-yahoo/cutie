# cutie

## What is this?

`cutie` is an application to make it easier to develop and glue together IoT & home automation applications. It primarily consists of three parts: a data transformation & routing layer (intended primarily as an MQTT listener/repeater), a software sensor platform for linux computers, and a provisioning script that installs `cutie` on a raspberry pi. It aims to be configuration-first, with code extensions to support use cases the configuration cannot. I wrote [a little bit about the motivation behind it here](https://blog.echobravoyahoo.net/the-problem-with-home-automation-software/).

### `cutie` as a data transformation & routing layer

`cutie` can listen to sensors or MQTT topics and transform the data or rebroadcast it to other MQTT topics or other data stores. This should enable users to integrate MQTT services that were not intended to be used together. Take a look at `./cookbook.md` for examples of how this functionality can be used.

### `cutie` as a sensor platform

`cutie` can be used as a sensor platform for a limited number of sensors (BME280 and BME680 temperature sensors, BLE presence tracking). It's primarily intended for deployment to small, linux-based computers (e.g., raspberry pi). Take a look at `./sensors.md` for an overview of currently supported sensors and how you can configure them.

### `cutie` as a raspberry pi provisioner

This functionality is also not really implemented yet, but you can take a look at the work in progress in the `./provisioner` directory.

## Platform requirements

Right now, `cutie` should run on any nodeJS environment between 17.9.0 - 24.x.x. My personal installation uses nodeJS 17 on 1st gen raspberry pi 0Ws. It should run in most linux environments, but individual sensors may fail to build or require OS utilities not present for some distributions. On ARMv6, it has to be built with python 3.10.8 or earlier.

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

### Mental model for using `cutie`

There are not very many parts to a `cutie` installation, but they look like this:

- A linux computer (optionally with some sensors attached)
  - With `cutie` installed (optionally installed as a sysctl service)
    - With a config file consisting of:
      - Connection configs, which define what data stores `cutie` can reach and what information it needs to reach them. To actually use a Connection, you'll need a Connection config and an Input or Output config - the Connection config contains the settings required to reach the data store at all, and the Input/Output configs contain the settings for that particular task.
      - Tasks, a description of one 'input, transform, output' pipeline. This usually represents some discrete sensor or task and contains Input, Transformation, and Output configs.
        - Input configs, which define what remote data sources and local sensors `cutie` should watch for changes in.
        - Transformation configs, which define how `cutie` should transform Messages after an Input but before an Output.
        - Output configs, which define destinations for cutie to send data to. These can be intermediate or final destinations.

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

If you say M**QT**T fast, it sounds like "em-cutie-tee". And software could stand to be a little cuter and more whimsical.

### Developing on `cutie`

These are primarily notes to myself for the time being.

#### Sensors

The `random` sensor runs without any hardware; use it to test changes to the runtime / behavior on your development box.

#### Logging

- Pretty logs for only one tag (in this case, "shadow"): `npm run start -- --config ./config/config-real.json | jq 'select(.tags | index( "shadow" ))'`

#### Deploying to a raspi for development

Problems with rsync: no watch daemon
`rsync --recursive --exclude "**/node_modules/*" --exclude "**/.git/*" --exclude "**/config.json"  --exclude "**.png" --exclude "**.zip" --exclude "**.md" --exclude "**/package-lock.json" ~/workspace/cutie/ vaxholm:/home/pi/cutie --verbose`

`git stash; git pull; git stash pop; sudo systemctl restart cutie; sudo journalctl -u cutie --follow`
