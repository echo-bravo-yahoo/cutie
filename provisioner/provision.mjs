#!/usr/bin/env node
//
// Build a cutie SD card image with sdm, and optionally burn it.
//
//   node provisioner/provision.mjs                     customize + shrink
//   node provisioner/provision.mjs --burn /dev/sdX     ... then burn
//   node provisioner/provision.mjs --skip-customize --burn /dev/sdX
//
// Secrets are never read from disk. The caller resolves them, which keeps the
// pi password and the wifi PSK out of every file in this repo:
//
//   cc-cred run CUTIE_PI_PASSWORD=op://Vault/Item/password \
//               CUTIE_WIFI_PSK=op://Vault/Item/password \
//               -- node provisioner/provision.mjs
//
// This script owns only the identity half of provisioning - password, wifi,
// locale, SSH key, and the services that must be disabled for a headless Trixie
// host to come up on the network at all. The convergent half lives in
// configure-host.sh, which sdm runs via --cscript and which can also be applied
// to an already-booted Pi over SSH.

import { createRequire } from "module";
import { accessSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
import parser from "yargs-parser";
import { readSync } from "node-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const CACHE_DIR = resolve(__dirname, "./cache");
const CSCRIPT = resolve(__dirname, "./configure-host.sh");

// Which base image and which Node architecture a board takes.
//
// ARMv6 is 32-bit-only silicon, so a Pi Zero W can never move to arm64 and is
// pinned to Node 22 - the last major with any 32-bit ARM build - permanently.
// Newer boards take arm64, where Node is a Tier 1 platform, so provisioning
// them 32-bit would inherit that dead end for no reason.
const BOARDS = {
  "pi-zero-w": {
    imageArch: "armhf",
    imageDate: "2026-06-19",
    imageFile: "2026-06-18-raspios-trixie-armhf-lite.img.xz",
  },
  "pi-zero-2-w": {
    imageArch: "arm64",
    imageDate: "2026-06-19",
    imageFile: "2026-06-18-raspios-trixie-arm64-lite.img.xz",
  },
};

function fail(message) {
  console.error(`\nprovision: ${message}\n`);
  process.exit(1);
}

function exists(path) {
  try {
    accessSync(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

function sh(command) {
  return new Promise((resolveP, reject) => {
    const child = spawn(command, [], {
      cwd: process.cwd(),
      shell: true,
      stdio: "inherit",
    });
    child.on("close", (code) =>
      code === 0
        ? resolveP(code)
        : reject(
            new Error(`command failed with exit code ${code}: ${command}`),
          ),
    );
    child.on("error", reject);
  });
}

function loadConfig() {
  const path = resolve(__dirname, "./config.json");
  if (!exists(path)) {
    fail(
      [
        "provisioner/config.json not found.",
        "Copy provisioner/config.example.json to provisioner/config.json and edit it.",
        "It holds no secrets - only op:// references to them.",
      ].join("\n  "),
    );
  }
  return require(path);
}

// Stage the cutie config this host will boot with.
//
// `cutieConfig` in provisioner/config.json names a real per-host config to ship
// - broker endpoint, credentials, the tasks that host actually runs. Without it
// the repo template is used, which carries placeholder MQTT credentials and so
// only produces a host that starts, not one that connects anywhere useful.
//
// Returns the staging DIRECTORY, not the file. sdm's copyfile plugin treats
// `to=` as a destination directory and keeps the source basename, so the staged
// file has to already be called cutie.conf.json - hence a per-host subdirectory
// rather than a per-host filename.
function stageCutieConfig(hostname, config) {
  const source = config.cutieConfig
    ? resolve(__dirname, config.cutieConfig)
    : resolve(__dirname, "../config/cutie.conf.yaml");

  if (!exists(source)) {
    fail(`cutieConfig ${source} not found.`);
  }
  if (!config.cutieConfig) {
    console.log(
      "NOTE: no cutieConfig set; shipping the repo template, whose MQTT\n" +
        "      credentials are placeholders. Set cutieConfig in config.json to\n" +
        "      ship a real per-host config.",
    );
  }

  // cutie's config loader accepts YAML or JSON regardless of extension, and
  // the repo template has comments -- require()'s built-in JSON loader can't
  // parse those, so this uses the same reader cutie itself loads configs
  // with.
  const template = readSync(source);
  const staged = { ...template, name: hostname };

  // configProvider makes the retained MQTT message the source of truth for this
  // host's tasks, so it needs a connection that can actually reach the broker.
  // Fabricating one with only a topic - which the repo template's absent
  // configProvider would produce - crashes at startup with
  // `Could not find connection "undefined"`. Better to ship no provider and let
  // the host run its local config than to ship a broken one.
  const connectionName =
    template.configProvider?.connectionName ??
    template.connections?.find((c) => c.type === "connection:mqtt")?.name;

  if (connectionName) {
    staged.configProvider = {
      ...(template.configProvider ?? {}),
      connectionName,
      topic: `cutie/config/${hostname}`,
    };
  } else {
    delete staged.configProvider;
    console.log(
      "NOTE: no MQTT connection in the config, so no configProvider is set;\n" +
        "      the host will run the tasks in its local config file.",
    );
  }

  const dir = resolve(CACHE_DIR, "staged", hostname);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "cutie.conf.json"),
    `${JSON.stringify(staged, null, 2)}\n`,
  );
  return dir;
}

function requireSecrets(config) {
  const wanted = [
    ["CUTIE_PI_PASSWORD", config.secrets?.piPassword],
    ["CUTIE_WIFI_PSK", config.secrets?.wifiPsk],
  ];
  const missing = wanted.filter(([name]) => !process.env[name]);
  if (missing.length === 0) {
    // sdm plugin arguments are pipe-separated and reach sdm inside a
    // double-quoted shell word, so these characters would either truncate the
    // value or break the command apart. Failing loudly beats setting a password
    // that is silently not the one that was asked for.
    for (const [name] of wanted) {
      const offending = [...'|"$`\\'].filter((char) =>
        process.env[name].includes(char),
      );
      if (offending.length > 0) {
        fail(
          `${name} contains ${offending.join(" ")}, which sdm's plugin argument syntax cannot carry. Choose a value without those characters.`,
        );
      }
    }

    return {
      piPassword: process.env.CUTIE_PI_PASSWORD,
      wifiPsk: process.env.CUTIE_WIFI_PSK,
    };
  }

  const assignments = wanted
    .map(([name, ref]) => `${name}=${ref ?? "op://Vault/Item/password"}`)
    .join(" \\\n              ");
  fail(
    [
      `missing ${missing.map(([name]) => name).join(", ")} in the environment.`,
      "Resolve them with cc-cred, which prompts once and keeps the values off stdout:",
      "",
      `  cc-cred run ${assignments} \\`,
      `              -- node provisioner/provision.mjs ${process.argv.slice(2).join(" ")}`,
    ].join("\n  "),
  );
}

async function fetchBaseImage(board) {
  const url =
    `https://downloads.raspberrypi.com/raspios_lite_${board.imageArch}/images/` +
    `raspios_lite_${board.imageArch}-${board.imageDate}/${board.imageFile}`;
  const compressed = resolve(CACHE_DIR, board.imageFile);
  const image = compressed.replace(/\.xz$/, "");

  if (exists(image)) {
    console.log(`Using cached base image ${basename(image)}.`);
    return image;
  }

  if (!exists(compressed)) {
    console.log(`Downloading ${url}`);
    await sh(`curl -fL --progress-bar -o '${compressed}' '${url}'`);

    // Verify before decompressing. This image becomes the boot device for a
    // headless host, and a truncated download would otherwise surface much
    // later as an unexplained sdm or boot failure. Raspberry Pi publishes the
    // digest beside the image; the file it names is bare, so the check runs
    // from the cache directory.
    console.log(`Verifying ${board.imageFile}.`);
    await sh(
      `curl -fsSL '${url}.sha256' | (cd '${CACHE_DIR}' && sha256sum -c -)`,
    );
  }

  console.log(`Decompressing ${board.imageFile}.`);
  await sh(`unxz --keep '${compressed}'`);
  return image;
}

function buildCustomizeCommand({ config, image, secrets, cutieConfig }) {
  const { wifi, locale, sshPubKey, cutie } = config;
  const srcDir = `${resolve(__dirname, cutie.srcPath)}/`;
  const rsyncExclude = resolve(__dirname, "./rsync-exclude.txt");
  const authorizedKeys = config.authorizedKeys
    ? resolve(__dirname, config.authorizedKeys)
    : null;

  if (authorizedKeys && !exists(authorizedKeys)) {
    fail(`authorizedKeys file ${authorizedKeys} not found.`);
  }
  if (!authorizedKeys && !exists(sshPubKey)) {
    fail(`sshPubKey ${sshPubKey} not found.`);
  }

  const plugins = [
    // -- Identity. Image-time only: each of these can strand a headless host, so
    // -- none of them is ever re-applied to a running Pi.
    `user:"setpassword=${config.user ?? "pi"}|password=${secrets.piPassword}"`,
    `L10n:"keymap=${locale.keymap}|locale=${locale.locale}|timezone=${locale.timezone}|wificountry=${wifi.country}"`,
    `network:"ifname=wlan0|wifissid=${wifi.ssid}|wifipassword=${secrets.wifiPsk}|wificountry=${wifi.country}"`,
    // Trixie's netplan integration writes .nmconnection files to
    // /run/NetworkManager instead of /etc, which loses them across a reboot.
    // disables:cloudinit swaps in the stock Debian NetworkManager. Without it a
    // headless Trixie Pi does not come back on the network.
    `disables:"cloudinit|piwiz|triggerhappy"`,
    // Relocates lo.nmconnection to /etc/NetworkManager/system-connections, per
    // sdm's Trixie hints - the companion to disables:cloudinit.
    `network:"cname=lo|ifname=lo|ctype=loopback|ipv4-static-ip=127.0.0.1/8|autoconnect=no"`,
    // SSH access. `authorizedKeys` wins when set, because a fleet host usually
    // has more keys authorized than the one machine building the image, and
    // importing a single pubkey would silently drop the rest. The two are
    // mutually exclusive: both write the same file.
    // copyfile's `to` is a DIRECTORY and the file keeps its source basename, so
    // the source must already be named authorized_keys. Passing the full file
    // path fails outright without mkdirif - and, worse, silently creates a
    // directory of that name and nests the file inside it when mkdirif is set.
    ...(authorizedKeys
      ? [
          `mkdir:"dir=/home/pi/.ssh|chown=pi:pi|chmod=700"`,
          `copyfile:"from=${authorizedKeys}|to=/home/pi/.ssh|chown=pi:pi|chmod=600"`,
        ]
      : [`sshkey:"sshuser=${config.user ?? "pi"}|import-pubkey=${sshPubKey}"`]),

    // -- Bootstrap. Puts the cutie checkout in place so the custom phase script
    // -- finds config/cutie.service to install.
    `mkdir:"dir=/home/pi/logs|chown=pi:pi"`,
    `mkdir:"dir=${cutie.destPath}|chown=pi:pi"`,
    `copydir:"from=${srcDir}|to=${cutie.destPath}|rsyncopts=-a --exclude-from ${rsyncExclude} --owner --group"`,
    // cutieConfig is a directory holding a file already named cutie.conf.json;
    // it overwrites the template copydir just placed (sdm renames the displaced
    // one to cutie.conf.json.sdm).
    `copyfile:"from=${cutieConfig}/cutie.conf.json|to=${cutie.destPath}/config|chown=pi:pi"`,
  ];

  // `files` maps a source file to the destination DIRECTORY it lands in,
  // matching copyfile's own semantics.
  for (const [src, destDir] of Object.entries(config.files ?? {})) {
    plugins.push(`copyfile:"from=${src}|to=${destDir}|mkdirif"`);
  }

  return [
    "sudo sdm --customize",
    ...plugins.map((plugin) => `--plugin ${plugin}`),
    // Everything convergent - buses, swap, packages, Node, the cutie service -
    // comes from the one script that also runs against live hosts. sdm calls it
    // with a phase argument; it does its work in post-install, after the plugins
    // above have staged the checkout.
    `--cscript ${CSCRIPT}`,
    "--extend --xmb 8192",
    // Without this sdm records the plugin arguments verbatim in the image's
    // /etc/sdm/history, which means the wifi PSK and the pi password ship on the
    // card in plaintext. The directory is mode 700, so it is root-only on a
    // running host - but a lost card read elsewhere gives up the wifi key.
    "--redact",
    "--regen-ssh-host-keys",
    "--restart",
    "--batch",
    `'${image}'`,
  ].join(" \\\n  ");
}

// lsblk reads sysfs and needs no privileges, so the device can be described
// before sudo is ever invoked. TRAN and MODEL are the columns that actually
// distinguish a card reader from an internal disk; a bare path does not.
function deviceSummary(device) {
  try {
    return execSync(
      `lsblk --output NAME,SIZE,TYPE,TRAN,MODEL,FSTYPE,LABEL,FSUSE%,MOUNTPOINTS '${device}'`,
      { encoding: "utf8" },
    ).trimEnd();
  } catch {
    return null;
  }
}

// Used and free are only knowable for a MOUNTED filesystem - statvfs needs a
// mountpoint - so an unmounted card reports blanks. That is not a gap worth
// closing by mounting the target: anything mounted is the dangerous case, and
// it gets called out separately below.
function mountPoints(device) {
  try {
    return execSync(`lsblk --noheadings --output MOUNTPOINTS '${device}'`, {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function confirmBurn(device, image) {
  if (!exists(device)) {
    fail(`${device} does not exist. Check \`lsblk\` for the right path.`);
  }

  const summary = deviceSummary(device);
  const mounted = mountPoints(device);
  const imageSize = statSync(image).size;

  // Printed even when CUTIE_BURN_CONFIRM bypasses the question, so an
  // unattended run still leaves a record of what it wrote over.
  console.log(`\nSource: ${image}`);
  console.log(`        ${(imageSize / 1e9).toFixed(2)} GB\n`);
  console.log(`Target: ${device} - EVERY BYTE BELOW WILL BE DESTROYED\n`);
  console.log(summary ?? `  (could not read ${device} via lsblk)`);
  console.log(
    "\n  Used and free are blank unless a partition is mounted; that is normal for a card.",
  );

  if (mounted.length > 0) {
    console.log(`\n  !! MOUNTED AT: ${mounted.join(", ")}`);
    console.log("  !! Something is using this device. This is probably wrong.");
  }

  if (process.env.CUTIE_BURN_CONFIRM === device) {
    console.log("\nCUTIE_BURN_CONFIRM matches; proceeding without prompting.");
    return;
  }

  if (!process.stdin.isTTY) {
    fail(
      [
        `refusing to burn ${device} without confirmation.`,
        `Re-run with CUTIE_BURN_CONFIRM=${device} set, or from a terminal.`,
      ].join("\n  "),
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nRetype the device path to confirm: `);
  rl.close();
  if (answer.trim() !== device) {
    fail("confirmation did not match; nothing was burned.");
  }
}

async function main() {
  const argv = parser(process.argv.slice(2), {
    string: ["burn"],
    boolean: ["skip-customize", "skip-shrink", "dry-run"],
    default: {
      "skip-customize": false,
      "skip-shrink": false,
      "dry-run": false,
    },
  });

  const config = loadConfig();
  const board = BOARDS[config.board];
  if (!board) {
    fail(
      `unknown board "${config.board}". Known boards: ${Object.keys(BOARDS).join(", ")}.`,
    );
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const customImage = resolve(
    CACHE_DIR,
    `${config.hostname}.${board.imageFile.replace(/\.img\.xz$/, "")}.img`,
  );

  if (!argv["skip-customize"]) {
    const secrets = requireSecrets(config);
    const cutieConfig = stageCutieConfig(config.hostname, config);

    // --dry-run prints the sdm invocation and stops, so the plugin list can be
    // reviewed without downloading an image or touching a device. Secrets are
    // masked: the real command interpolates them, and this is the one place
    // they would otherwise reach a terminal.
    if (argv["dry-run"]) {
      const command = buildCustomizeCommand({
        config,
        image: customImage,
        secrets: {
          piPassword: "<CUTIE_PI_PASSWORD>",
          wifiPsk: "<CUTIE_WIFI_PSK>",
        },
        cutieConfig,
      });
      console.log(command);
      return;
    }

    const baseImage = await fetchBaseImage(board);

    console.log(`Copying base image to ${basename(customImage)}.`);
    await sh(`cp '${baseImage}' '${customImage}'`);

    console.log("Running sdm customize.");
    await sh(
      buildCustomizeCommand({
        config,
        image: customImage,
        secrets,
        cutieConfig,
      }),
    );

    if (!argv["skip-shrink"]) {
      console.log("Running sdm shrink.");
      await sh(`sudo sdm --shrink '${customImage}'`);
    }
  }

  if (!argv.burn) {
    console.log(`\nImage ready: ${customImage}`);
    console.log(
      `Burn it with: node provisioner/provision.mjs --skip-customize --burn /dev/sdX`,
    );
    return;
  }

  if (!exists(customImage)) {
    fail(`${customImage} not found; run without --skip-customize first.`);
  }

  await confirmBurn(argv.burn, customImage);
  console.log(`Running sdm burn to ${argv.burn}.`);
  await sh(
    [
      `sudo sdm --burn ${argv.burn}`,
      `--hostname ${config.hostname}`,
      "--expand-root",
      `'${customImage}'`,
    ].join(" "),
  );
  console.log(`\nBurned ${config.hostname} to ${argv.burn}.`);
}

await main();
