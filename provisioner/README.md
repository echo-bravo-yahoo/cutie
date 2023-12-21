### To-do
#### Highest
- Move from (4 IoT rules -> Cloudwatch) to (IoT Rule -> Lambda -> Cloudwatch) to be able to support metric dimensions
- Hook cron/pm2/islands together
- Figure out why I2C, SPI setup doesn't work
- Figure out why ./install-node.sh isn't run automatically

#### Ops
- Set up a real dev environment on Kungsholmen
- Script to trash an island's resources

#### Extensions
- Add "scripts" section to shadow

#### Usability
- Add stub for config.json file

### Strategy
We're using [sdm](https://github.com/gitbls/sdm) to provision islands.

Image from [here](https://downloads.raspberrypi.com/raspios_lite_armhf/images/raspios_lite_armhf-2023-12-11/2023-12-11-raspios-bookworm-armhf-lite.img.xz).
