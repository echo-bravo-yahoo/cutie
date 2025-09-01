## New notes

```
sudo mv /usr/bin/npx /usr/bin/npx-backup
sudo mv /usr/bin/npm /usr/bin/npm-backup
sudo mv /usr/bin/node /usr/bin/node-backup

curl -L https://unofficial-builds.nodejs.org/download/release/v21.7.3/node-v21.7.3-linux-armv6l.tar.xz | tar xJ
cd node-*

sudo cp ./bin/node /usr/bin/node
sudo cp ./bin/npx /usr/bin/npx
sudo cp ./bin/npm /usr/bin/npm

sudo vi /etc/dphys-swapfile
# increase swapfile to 6144
# increase max to 8096

sudo /etc/init.d/dphys-swapfile restart

NODE_OPTIONS=--max_old_space_size=6144 npm run build
```

### Tasks to do that are not in provisioner

- `sudo apt-get install bc bluez-hcidump mosquitto mosquitto-clients`

### To-do

#### Highest

- Figure out why ./install-node.sh isn't run automatically

#### Ops

- Detect if necessary to copy node_modules_prebuilt to node_modules

#### Extensions

#### Usability

### Strategy

We're using [sdm](https://github.com/gitbls/sdm) to provision cutie instances on raspberry pis.

Image from [here](https://downloads.raspberrypi.com/raspios_lite_armhf/images/raspios_lite_armhf-2023-12-11/2023-12-11-raspios-bookworm-armhf-lite.img.xz).
