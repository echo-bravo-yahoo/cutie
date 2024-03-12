#!/usr/bin/env bash

# set up node and npm
# run as root or sudo
chown -R pi:pi /home/pi/islands && \
cd /usr/bin && \
ln -s /usr/local/node/bin/node node && \
ln -s /usr/local/node/bin/npm npm;

# set up PATH
printf '\n\nexport PATH=$PATH:/usr/local/node/bin' >> /home/pi/.bashrc;

# set up pm2
sudo npm install pm2 --location=global && \
sudo env PATH=$PATH:/usr/local/node/bin /usr/local/node/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root && \
cd /home/pi/islands/islands-rewrite && \
sudo env PATH=$PATH:/usr/local/node/bin pm2 start island.pm2.config.cjs && \
sudo env PATH=$PATH:/usr/local/node/bin pm2 save
