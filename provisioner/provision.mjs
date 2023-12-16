import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const config = require('./config.json')

const img = '2023-12-11-raspios-bookworm-armhf-lite.img'

let customize = 'sudo sdm --customize '
customize += `--plugin user:"setpassword=pi|password=${config.password}" `
customize += `--plugin L10n:host `
customize += `--plugin disables:piwiz `
customize += `--plugin network:"wifissid=${config.wifi.ssid}|wifipassword=${config.wifi.password}" `
customize += `--plugin copydir:"from=${config.islands.srcPath}|to=${config.islands.destPath}" `

// cmake and golang are required to build aws-crt
customize += `--plugin apps:"apps=git,cmake,golang" `

// default swap is 100 mb, and is too small to compile aws-crt (dependency of aws-iot-device-sdk-v2)
// have not dialed it in yet, but 4 GB does provide enough headroom to build aws-crt
customize += `--plugin system:"swap=4096" `

// customize += `--plugin raspiconfig:"overclock=`

customize += `--regen-ssh-host-keys `
customize += `--restart `
customize += `${img}`

console.log(customize)

const device = '/dev/sde'

let burn = `sudo sdm --burn ${device} `
burn += `--hostname ${config.hostname} `
burn += `--expand-root `
burn += `${img}`

console.log(burn)
