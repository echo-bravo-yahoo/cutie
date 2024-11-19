import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const config = require(resolve(__dirname, './provisioner/config.json'))
const islandConfig = require(resolve(__dirname, './islands-rewrite/config.json'))

import { rmSync, cpSync, accessSync, constants } from 'node:fs'
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'path'
import { execSync, spawn } from 'child_process'

import { createKeysAndRegisterThing } from './iot-cp.mjs'

const baseImg = '2023-12-11-raspios-bookworm-armhf-lite.img'
const customImg = `${baseImg.split('.')[0]}.custom.${baseImg.split('.')[1]}`

const nodeVersion = '17.9.1'
const arch = 'armv6l'

const certFilePath = resolve(`${config.authorizedKeys}`, `../islands/${config.hostname}-certificate.pem.crt`)
const privateKeyFilePath = resolve(`${config.authorizedKeys}`, `../islands/${config.hostname}-private.pem.key`)
const publicKeyFilePath = resolve(`${config.authorizedKeys}`, `../islands/${config.hostname}-public.pem.key`)
// const awsCertFilePath = '/home/pi/.ssh/islands/AmazonRootCA1.pem'

try {
  await Promise.all([
    access(certFilePath, constants.R_OK),
    access(privateKeyFilePath, constants.R_OK),
    access(publicKeyFilePath, constants.R_OK)
  ])
  console.log(`Found existing keys for ${config.hostname}. Using them.`)
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log(`Keys not found for hostname ${config.hostname}. Creating new keys now.`)
    await createKeysAndRegisterThing()
  } else {
    throw e
  }
}

// write custom islandConfig
islandConfig.name = config.hostname
islandConfig.certId = (await readFile(`/home/pi/.ssh/islands/${config.hostname}-certificate.id`, { encoding: 'utf8' })).trim()
islandConfig.certFilePath = `/home/pi/islands/${config.hostname}-certificate.pem.crt`
islandConfig.awsCertFilePath = `/home/pi/islands/AmazonRootCA1.pem`
islandConfig.privateKeyFilePath = `/home/pi/islands/${config.hostname}-private.pem.key`
islandConfig.publicKeyFilePath = `/home/pi/islands/${config.hostname}-public.pem.key`
await writeFile(resolve(__dirname, '../islands-rewrite/config.json'), JSON.stringify(islandConfig, null, 2))

try {
  accessSync(resolve(__dirname, './cache/', `node-v${nodeVersion}-linux-armv6l`))
  console.log(`Found node v${nodeVersion}, using that.`)
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log(`Could not find node v${nodeVersion}, downloading it now.`)
    execSync(`
      cd ${resolve(__dirname, './cache/')} &&
      wget --no-check-certificate --quiet https://unofficial-builds.nodejs.org/download/release/v${nodeVersion}/node-v${nodeVersion}-linux-${arch}.tar.xz >/dev/null && \
        tar -xf node-v${nodeVersion}-linux-${arch}.tar.xz >/dev/null
    `)
    console.log(`Done downloading node v${nodeVersion}.`)
 } else {
  throw e
  }
}

try {
  accessSync(resolve(__dirname, './cache/', baseImg))
  console.log(`Found base image ${baseImg}, using that.`)
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log(`Could not find base image ${baseImg}, downloading it now.`)
    // TODO: Get rid of hardcoded datestamp, extract it from the baseImg name
    execSync(`
      cd ${resolve(__dirname, './cache/')} &&
      wget --no-check-certificate --quiet https://downloads.raspberrypi.com/raspios_lite_armhf/images/raspios_lite_${'armhf'}-2023-12-11/${baseImg}.xz && \
        unxz ${baseImg}.xz
    `)
    console.log(`Done downloading base image ${baseImg}.`)
 } else {
  throw e
  }
}

await sh(`rm ${resolve(__dirname, './cache/', customImg)}`)
await sh(`cp ${resolve(__dirname, './cache/', baseImg)} ${resolve(__dirname, './cache/', customImg)}`)

if (false) {
  console.log('Deleting local node modules...')
  rmSync(resolve(__dirname, '../islands-rewrite/node_modules'), { recursive: true, force: true })
  console.log('Copying pre-built raspi 0 node modules...')
  cpSync(resolve(__dirname, './cache/node_modules_prebuilt'), resolve(__dirname, '../islands-rewrite/node_modules'), { recursive: true })
}

console.log('Running sdm.')
let customize = 'sudo sdm --customize '
customize += `--plugin user:"setpassword=pi|password=${config.password}" `
customize += `--plugin L10n:host `
customize += `--plugin disables:piwiz `
customize += `--plugin network:"wifissid=${config.wifi.ssid}|wifipassword=${config.wifi.password}" `

// IoT application
customize += `--plugin mkdir:"dir=/home/pi/.ssh|chown=pi:pi" `
customize += `--plugin mkdir:"dir=/home/pi/islands|chown=pi:pi" `
customize += `--plugin mkdir:"dir=/home/pi/logs|chown=pi:pi" `
customize += `--plugin mkdir:"dir=/home/pi/workspace|chown=pi:pi" `
customize += `--plugin copydir:"from=${resolve(__dirname, config.islands.srcPath)}|to=${config.islands.destPath}|rsyncopts=-a --exclude-from ${resolve(__dirname, './rsync-exclude.txt')} --owner --group --progress" `

// SSH authorized keys
customize += `--plugin copyfile:"from=${config.authorizedKeys}|to=/home/pi/.ssh" `

// github SSH key
customize += `--plugin copyfile:"from=${config.github.privateKeyFilePath}|to=/home/pi/.ssh" `

// SSH config
customize += `--plugin copyfile:"from=${resolve(__dirname, config.islands.srcPath, './provisioner/config')}|to=/home/pi/.ssh" `

// AWS IoT certs
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-certificate.pem.crt|to=/home/pi/islands" `
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-private.pem.key|to=/home/pi/islands" `
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-public.pem.key|to=/home/pi/islands" `
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/AmazonRootCA1.pem|to=/home/pi/islands" `

// aws-iot-device-sdk-v2 build
// cmake and golang are required to build aws-crt
// customize += `--plugin apps:"name=dev|apps=git,cmake,golang" `
customize += `--plugin apps:"name=dev|apps=git,i2c-tools,pigpio" `

// default swap is 100 mb, and is too small to compile aws-crt (dependency of aws-iot-device-sdk-v2)
// have not dialed it in yet, but 4 GB does provide enough headroom to build aws-crt
customize += `--plugin system:"name=swap|swap=4096" `

// customize += `--plugin raspiconfig:"overclock=`
customize += `--plugin raspiconfig:"i2c=0|serial=0" `

// extend the image to fit
customize += `--extend --xmb 4096 `

// install nodejs
customize += `--plugin copydir:"from=${resolve(__dirname, `./cache/node-v${nodeVersion}-linux-${arch}`) + '/'}|to=/usr/local/node" `
customize += `--plugin copyfile:"from=${resolve(__dirname, `./install-node.sh`)}|to=/home/pi" `
customize += `--plugin runatboot:"script=/home/pi/islands/provisioner/install-node.sh|output=/home/pi/logs/install-node.log" `

customize += `--regen-ssh-host-keys `
customize += `--restart `
customize += `--batch `
customize += `${resolve(__dirname, `./provisioner/cache/${customImg}`)}`

async function sh(cmd) {
  return new Promise((resolve, reject) => {
    const subProcess = spawn(cmd, [], {
      cwd: process.cwd(),
      detached: true,
      shell: true,
      stdio: "inherit"
    })

    subProcess.on('close', resolve)
    subProcess.on('error', reject)
  })
}

await sh(customize)
await sh(`sudo sdm --shrink ${resolve(__dirname, `./cache/${customImg}`)}`)

const device = '/dev/sde'

let burn = `sudo sdm --burn ${device} `
burn += `--hostname ${config.hostname} `
burn += `--expand-root `
burn += `./cache/${customImg}`

console.log(burn, '\n')
