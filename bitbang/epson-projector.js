const { transmitNECCommand } = require('./nec.js')

async function standby(pigpio) {
  console.log(`Transmitting standby command.`)
  return transmitNECCommand(pigpio, 0x7c, 0x6e, 0xaa)
}

async function on(pigpio) {
  console.log(`Transmitting on command.`)
  return transmitNECCommand(pigpio, 0x7c, 0x6f, 0xaa)
}

async function volumeUp(pigpio) {
  console.log(`Transmitting volume up command.`)
  return transmitNECCommand(pigpio, 0x7c, 0x67, 0xaa)
}

async function volumeDown(pigpio) {
  console.log(`Transmitting volume down command.`)
  return transmitNECCommand(pigpio, 0x7c, 0x66, 0xaa)
}

async function mute(pigpio) {
  console.log(`Transmitting mute command.`)
  return transmitNECCommand(pigpio, 0x7c, 0x52, 0xaa)
}

module.exports = {
  standby,
  on,
  volumeUp,
  volumeDown,
  mute
}
