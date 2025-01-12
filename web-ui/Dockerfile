# node v23.y.z, alpine vx.y.z
FROM node:23-alpine

WORKDIR /usr/local/islands-ui

# dependencies first for docker cache reasons:
# https://docs.docker.com/get-started/docker-concepts/building-images/using-the-build-cache/
COPY package.json package-lock.json .
RUN npm install

COPY . .
EXPOSE 8080

# CMD tail -f /dev/null

# runs package.json's main script
CMD ["node", "/usr/local/islands-ui/node_modules/.bin/nodemon"]
