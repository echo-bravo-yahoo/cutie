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
su -c "npm install pm2 --location=global" root && \
sudo env PATH=$PATH:/usr/local/node/bin /usr/local/node/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /home/pi && \
su -c "env PATH=$PATH:/usr/local/node/bin pm2 start /home/pi/islands/islands-rewrite/island.pm2.config.cjs" root && \
su -c "env PATH=$PATH:/usr/local/node/bin pm2 save" root
