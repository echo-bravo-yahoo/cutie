### Tasks to do that are not in provisioner

- `sudo apt-get install bc bluez-hcidump mosquitto mosquitto-clients`
- `git clone https://github.com/andrewjfreyer/monitor.git; cd monitor; sudo ./monitor.sh`

### To-do

#### Highest

- Figure out why ./install-node.sh isn't run automatically
- Fix application start-up issues (much noisier over MQTT than necessary, and leaves module.currentState untrustable)
- Make output logging... usable
- Hook cron/pm2/islands together

#### Ops

- Detect if necessary to copy node_modules_prebuilt to node_modules
- Set up a real dev environment on Kungsholmen
- Script to trash an island's resources

#### Extensions

- Add "scripts" section to shadow

#### Usability

- Add stub for config.json file

### Strategy

We're using [sdm](https://github.com/gitbls/sdm) to provision islands.

Image from [here](https://downloads.raspberrypi.com/raspios_lite_armhf/images/raspios_lite_armhf-2023-12-11/2023-12-11-raspios-bookworm-armhf-lite.img.xz).
