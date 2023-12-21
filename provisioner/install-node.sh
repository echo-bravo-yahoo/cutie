#!/usr/bin/env bash

# run as root or sudo

chown -R pi:pi /home/pi/islands && \
cd /usr/bin && \
ln -s /usr/local/node/bin/node node && \
ln -s /usr/local/node/bin/npm npm
