import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const config = require('./config.json')

import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))

import { rmSync, cpSync } from 'node:fs'
import { resolve, dirname } from 'path'
import { execSync } from 'child_process'

const img = '2023-12-11-raspios-bookworm-armhf-lite.img'

console.log('Deleting local node modules...')
rmSync(resolve(__dirname, '../islands-rewrite/node_modules'), { recursive: true, force: true })
console.log('Copying pre-built raspi 0 node modules...')
cpSync(resolve(__dirname, './node_modules_prebuilt'), resolve(__dirname, '../islands-rewrite/node_modules'), { recursive: true })

console.log('Running sdm command:', '\n')
let customize = 'sudo sdm --customize '
customize += `--plugin user:"setpassword=pi|password=${config.password}" `
customize += `--plugin L10n:host `
customize += `--plugin disables:piwiz `
customize += `--plugin network:"wifissid=${config.wifi.ssid}|wifipassword=${config.wifi.password}" `
customize += `--plugin copydir:"from=${resolve(config.islands.srcPath)}|to=${config.islands.destPath}" `

customize += `--plugin mkdir:"dir=/home/pi/.ssh|chown=pi:pi" `

// SSH authorized keys
customize += `--plugin copyfile:"from=${config.authorizedKeys}|to=/home/pi/.ssh" `

// AWS IoT certs
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-certificate.pem.crt|to=/home/pi/islands" `
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-private.pem.key|to=/home/pi/islands" `
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-public.pem.key|to=/home/pi/islands" `

// aws-iot-device-sdk-v2 build
// cmake and golang are required to build aws-crt
customize += `--plugin apps:"apps=git,cmake,golang" `

// default swap is 100 mb, and is too small to compile aws-crt (dependency of aws-iot-device-sdk-v2)
// have not dialed it in yet, but 4 GB does provide enough headroom to build aws-crt
customize += `--plugin system:"swap=4096" `

// customize += `--plugin raspiconfig:"overclock=`

customize += `--regen-ssh-host-keys `
customize += `--restart `
customize += `${img}`

console.log(customize, '\n')
execSync(customize)

const device = '/dev/sde'

let burn = `sudo sdm --burn ${device} `
burn += `--hostname ${config.hostname} `
burn += `--expand-root `
burn += `${img}`

console.log(burn, '\n')
