# alpine does not work with the AWS SDK
FROM node:20

# dependencies first for docker cache reasons:
# https://docs.docker.com/get-started/docker-concepts/building-images/using-the-build-cache/

WORKDIR /usr/local/islands
COPY ./islands-rewrite/package.json ./islands-rewrite/package-lock.json .
RUN npm install

WORKDIR /usr/local/bitbang
COPY ./bitbang/package.json ./bitbang/package-lock.json .
RUN npm install

WORKDIR /usr/local/islands
COPY ./islands-rewrite .

WORKDIR /usr/local/bitbang
COPY ./bitbang .

WORKDIR /usr/local/islands
EXPOSE 8080

# CMD tail -f /dev/null

# runs package.json's main script
CMD ["node", "/usr/local/islands/node_modules/.bin/nodemon"]
