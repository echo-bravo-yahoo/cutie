FROM node:22-slim

# i2c-bus and pigpio are native modules, so node-gyp needs a toolchain and
# python; the slim base image ships neither.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# dependencies first for docker cache reasons:
# https://docs.docker.com/get-started/docker-concepts/building-images/using-the-build-cache/

WORKDIR /usr/local/cutie
COPY ./package.json ./package-lock.json .
RUN npm ci

COPY . .
RUN npm run build

# Defaults to the shipped starter config, matching npm run start:prod. Mount
# your own over it, or override the command, to run a real config.
CMD ["node", "built/cli-entrypoint.js", "start", "--config", "./config/cutie.conf.yaml"]
