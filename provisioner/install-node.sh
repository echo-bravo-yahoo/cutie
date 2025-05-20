#!/usr/bin/env bash

# set up node and npm
# run as root or sudo
chown -R pi:pi /home/pi/cutie && \
cd /usr/bin && \
ln -s /usr/local/node/bin/node node && \
ln -s /usr/local/node/bin/npm npm;

# set up PATH
printf '\n\nexport PATH=$PATH:/usr/local/node/bin' >> /home/pi/.bashrc;

# install cutie with systemctl
cd /home/pi/cutie && npm run add-service
