import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const config = require('./config.json')

import { rmSync, copyFileSync } from 'node:fs'
import { normalize } from 'path'
import { execSync } from 'child_process'

const img = '2023-12-11-raspios-bookworm-armhf-lite.img'

console.log('Deleting local node modules...')
rmSync(normalize('../islands-rewrite/node_modules'), { recursive: true, force: true })
console.log('Copying pre-built raspi 0 node modules...')
copyFileSync(normalize('./node_modules_prebuilt'), normalize('../node_modules'))

console.log('Running sdm command:', '\n')
let customize = 'sudo sdm --customize '
customize += `--plugin user:"setpassword=pi|password=${config.password}" `
customize += `--plugin L10n:host `
customize += `--plugin disables:piwiz `
customize += `--plugin network:"wifissid=${config.wifi.ssid}|wifipassword=${config.wifi.password}" `
customize += `--plugin copydir:"from=${config.islands.srcPath}|to=${config.islands.destPath}" `

// SSH authorized keys
customize += `--plugin copydir:"from=${config.authorizedKeys}|to=/home/pi/.ssh/authorized_keys" `

// AWS IoT certs
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-certificate.pem.crt|to=/home/pi/islands/${config.hostname}-certificate.pem.crt`
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-private.pem.key|to=/home/pi/islands/${config.hostname}-private.pem.key`
customize += `--plugin copyfile:"from=/home/pi/.ssh/islands/${config.hostname}-public.pem.key|to=/home/pi/islands/${config.hostname}-public.pem.key`

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
