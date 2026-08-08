// provide `cutie_provisioner_device` as an env variable
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require(resolve(__dirname, "./config.json"));
const cutieConfig = require(resolve(__dirname, "..", "./config/config.json"));

import { accessSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "path";
import { execSync, spawn } from "child_process";

const { arch, hostname, imageUrl, nodeVersion } = config;
const baseImgPath = imageUrl.split("/").pop();
const customImgPath = `${baseImgPath.split(".")[0]}.custom.${baseImgPath.split(".")[1]}`;

function removeExtension(path) {
  if (path.endsWith(".xz")) return path.slice(0, -3);
  return path;
}

// write custom cutieConfig
cutieConfig.configProvider.topic = `cutie/config/${hostname}`;
cutieConfig.name = hostname;
await writeFile(
  resolve(__dirname, "../config/config.json"),
  JSON.stringify(cutieConfig, null, 2),
);

try {
  accessSync(
    resolve(__dirname, "./cache/", `node-v${nodeVersion}-linux-armv6l`),
  );
  console.log(`Found cached node v${nodeVersion}, using that.`);
} catch (e) {
  if (e.code === "ENOENT") {
    console.log(
      `Could not find cached node v${nodeVersion}, downloading it now.`,
    );
    execSync(`
      cd ${resolve(__dirname, "./cache/")} &&
      wget --no-check-certificate --quiet https://unofficial-builds.nodejs.org/download/release/v${nodeVersion}/node-v${nodeVersion}-linux-${arch}.tar.xz >/dev/null && \
        tar -xf node-v${nodeVersion}-linux-${arch}.tar.xz >/dev/null
    `);
    console.log(`Done downloading node v${nodeVersion}.`);
  } else {
    throw e;
  }
}

try {
  accessSync(resolve(__dirname, "./cache/", removeExtension(baseImgPath)));
  console.log(
    `Found cached base image ${removeExtension(baseImgPath)}, using that.`,
  );
} catch (e) {
  if (e.code === "ENOENT") {
    console.log(
      `Could not find cached base image ${removeExtension(baseImgPath)}, downloading it now.`,
    );
    execSync(`
      cd ${resolve(__dirname, "./cache/")} &&
      wget --no-check-certificate --quiet ${imageUrl} && \
        unxz ${baseImgPath}
    `);
    console.log(`Done downloading base image ${baseImgPath}.`);
  } else {
    throw e;
  }
}

await sh(`rm ${resolve(__dirname, "./cache/", customImgPath)} 2> /dev/null`);
await sh(
  `cp ${resolve(__dirname, "./cache/", removeExtension(baseImgPath))} ${resolve(__dirname, "./cache/", customImgPath)}`,
);

console.log("Running sdm customize.");
let customize = "sudo sdm --customize ";
customize += `--plugin user:"setpassword=pi|password=${config.password}" `;
customize += `--plugin L10n:"keymap=us|locale=en_US.UTF-8|timezone=America/Los_Angeles|wificountry=US" `;
customize += `--plugin disables:"piwiz|triggerhappy" `;
customize += `--plugin network:"ifname=wlan0|wifissid=${config.wifi.ssid}|wifipassword=${config.wifi.password}" `;

// IoT application
customize += `--plugin mkdir:"dir=/home/pi/.ssh|chown=pi:pi" `;
customize += `--plugin mkdir:"dir=/home/pi/logs|chown=pi:pi" `;
customize += `--plugin mkdir:"dir=/home/pi/workspace/cutie|chown=pi:pi" `;
customize += `--plugin copydir:"from=${resolve(__dirname, config.cutie.srcPath) + "/"}|to=${config.cutie.destPath}|rsyncopts=-a --exclude-from ${resolve(__dirname, "./rsync-exclude.txt")} --owner --group --progress" `;

for (const [src, dest] of Object.entries(config.files))
  customize += `--plugin copyfile:"from=${src}|to=${dest}|mkdirif" `;

customize += `--plugin apps:"name=dev|apps=git,i2c-tools,pigpio" `;

// TODO: this isn't working!
customize += `--plugin system:"name=swap|swap=4096" `;

// customize += `--plugin raspiconfig:"overclock=`
customize += `--plugin raspiconfig:"i2c=0" `;
customize += `--plugin serial `;

// extend the image to fit
customize += `--extend --xmb 8192 `;

// install nodejs
customize += `--plugin copydir:"from=${resolve(__dirname, `./cache/node-v${nodeVersion}-linux-${arch}`) + "/"}|to=/usr/local/node" `;
customize += `--plugin copyfile:"from=${resolve(__dirname, `./install-node.sh`)}|to=/home/pi" `;
customize += `--plugin runatboot:"script=${resolve(__dirname, `./install-node.sh`)}|output=/home/pi/logs/install-node.log" `;

customize += `--regen-ssh-host-keys `;
customize += `--restart `;
customize += `--batch `;
customize += `${resolve(__dirname, `./cache/${customImgPath}`)}`;

async function sh(cmd) {
  return new Promise((resolve, reject) => {
    const subProcess = spawn(cmd, [], {
      cwd: process.cwd(),
      detached: true,
      shell: true,
      stdio: "inherit",
    });

    subProcess.on("close", resolve);
    subProcess.on("error", reject);
  });
}

await sh(customize);
await sh(`sudo sdm --shrink ${resolve(__dirname, `./cache/${customImgPath}`)}`);

// e.g., "/dev/sde"
const device = process.env.cutie_provisioner_device;

console.log("Running sdm burn.");
let burn = `sudo sdm --burn ${device} `;
burn += `--hostname ${hostname} `;
burn += `--expand-root `;
burn += `./provisioner/cache/${customImgPath}`;

console.log(burn, "\n");
