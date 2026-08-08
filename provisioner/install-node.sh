#!/usr/bin/env bash

# chown -R pi:pi /home/pi/cutie

# set up node and npm
cd /usr/bin
ln -s /usr/local/node/bin/node /usr/bin/node
ln -s /usr/local/node/bin/npm /usr/bin/npm
ln -s /usr/local/node/bin/npx /usr/bin/npx

# install cutie with systemctl
cd /home/pi/workspace/cutie && npm run add-service
