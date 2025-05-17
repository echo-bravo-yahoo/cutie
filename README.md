# m-cutie-t

## What is this?

`m-cutie-t` is an application to make it easier to develop and glue together IoT & home automation applications. It primarily consists of two parts, both works-in-progress: a sensor platform and an MQTT listener/repeater. It aims to be configuration-first, with code extensions to support use cases the configuration cannot. I wrote [a little bit about the motivation behind it here](https://blog.echobravoyahoo.net/the-problem-with-home-automation-software/).

### `m-cutie-t` as a sensor platform

`m-cutie-t` can be used as a sensor platform for a limited number of sensors (BME280 and BME680 temperature sensors, BLE presence tracking). It's primarily intended for deployment to small, linux-based computers (e.g., raspberry pi). You can see a default config file at `./config/config.json`. Currently, the sensor platform supports:

- Sampling multiple times per reporting window
- Aggregating samples in various ways (avg, latest, p25/50/75/X)
- Offsetting values before publishing them
- Delivering data to multiple MQTT or InfluxDB destinations

### `m-cutie-t` as an MQTT listener/repeater

This functionality is not implemented yet, but I plan to allow defining subscribe/transform/publish in config with the intent that users can integrate MQTT services that were not intended to be used together.

## Platform requirements

Right now, `m-cutie-t` is only tested to run on nodeJS 17 on 1st gen raspberry pi 0Ws. It should run in most linux environments, but individual sensors may fail to build or require OS utilities not present for some distributions.

## Installation & use

To use `m-cutie-t` as a CLI tool:

```bash
git clone git@github.com:echo-bravo-yahoo/m-cutie-t.git
cd m-cutie-t
npm install
npm link # optional, installs the CLI to your path as `m-cutie-t` and `cutie`
m-cutie-t # cutie also works to refer to the CLI
```

This starts `m-cutie-t` up using the config file present in `./config/config.json`. You'll need to customize it to fit your use-case. You can also pass a flag to the CLI to specify the location of a different config file, e.g., `cutie --config ~/my-config-file.json`. Config files can be JSON or YAML, with any extension.

Once you have it configured to your liking, you can install it to systemctl so it's run on startup and restarted on crash. First, modify `./config/m-cutie-t.service` to confirm that the `WorkingDirectory` and `user` fields are correct you can, then run `sudo cp ./m-cutie-t.service /etc/systemd/system/m-cutie-t.service` and `sudo systemctl enable m-cutie-t`.

### To-do

- [ ] Confirm full range of usable nodeJS versions (`engines` field in package.json)
- [ ] Build listen/repeat behavior
  - [ ] Customizable data transformations
  - [ ] Listen to topic pattern
  - [ ] Persistent queue vs transient queue
- [ ] Allow configuring `m-cutie-t` via MQTT
- [ ] Support other MQTT auth strategies
- [ ] Look for better sensor dependency management strategy
- [ ] Reimplement old `islands` sensors and outputs
  - [ ] infrared
  - [ ] NEC
  - [ ] switchbot
  - [ ] thermal-printer
- [ ] Document `destinations` concept
- [ ] Document `outputs` concept
- [ ] Document `provisioner` concept
- [ ] Update `provisioner`
- [ ] Update `Dockerfile`

### Developing on m-cutie-t

These are primarily notes to myself for the time being.

#### Sensors

The `random` sensor runs without any hardware; use it to test changes to the runtime / behavior on your development box.

#### Logging

- Pretty logs: `node index.js | pino-pretty`
- Pretty logs for only one tag (in this case, "shadow"): `node index.js | jq 'select(.tags | index( "shadow" ))' | pino-pretty`

#### Deploying to a raspi for development

Problems with rsync: no watch daemon
`rsync --recursive --exclude "**/node_modules/*" --exclude "**/.git/*" --exclude "**/config.json"  --exclude "**.png" --exclude "**.zip" --exclude "**.md" --exclude "**/package-lock.json" ~/workspace/m-cutie-t/ <node>:/home/pi/m-cutie-t --verbose`

`git stash; git pull; git stash pop; sudo systemctl restart m-cutie-t; sudo journalctl -u m-cutie-t --follow`
