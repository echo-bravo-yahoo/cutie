const pigpio = require('pigpio')
const Gpio = pigpio.Gpio

// const { necListener } = require('./adapters/nec.js')
// const { rawListener } = require('./adapters/raw.js')
const { mitsubishiListener, heat } = require('./adapters/mitsubishi-ac.js')
// const { standby } = require('./adapters/epson-projector.js')

const ledPin = 23
const infraredSensor = new Gpio(17, { mode: Gpio.INPUT, alert: true })
new Gpio(ledPin, { mode: Gpio.OUTPUT })

pigpio.waveClear()
console.log(`Max wave length, pulses: ${pigpio.waveGetMaxPulses()}`)
console.log(`Max wave length, uS: ${pigpio.waveGetMaxMicros()}`)
console.log(`Max control blocks: ${pigpio.waveGetMaxCbs()}`)

// infraredSensor.on('alert', (level, tick) => necListener(level, tick, pigpio))
// infraredSensor.on('alert', (level, tick) => rawListener(level, tick, pigpio))
// heat(pigpio)
// .then(() => {
  console.log(`Listening for new infrared pulses...`)
  infraredSensor.on('alert', (level, tick) => mitsubishiListener(level, tick, pigpio))
// })

/*
const { readByte, graphToTerminal, bitArrayToByte } = require('./helpers')
// 0x23
const durations = [
  1275,
  1275,
  450,
  450,
  450,
  1275,
  450,
  450,
]

const bits = readByte(durations, 0, false, 450, 1275)
console.log(JSON.stringify(bits))
const wave = bits.map((duration) => { return { level: 0, duration } })
console.log(`0x${bitArrayToByte(bits).toString(16)}`)
console.log(graphToTerminal(wave, [
  { duration: 1275, tolerance: .14 },
  { duration: 450 },
  { duration: 3500 },
  { duration: 17000 },
  { duration: 1700, tolerance: .14 },
]))
*/

// standby(pigpio)

module.exports = {}

