const pigpio = require('pigpio')
const Gpio = pigpio.Gpio

const { waveToNec, is, necToWave, highWaveFromDuration, lowWaveFromDuration, transmitNECCommand } = require('./nec.js')
const { standby } = require('./epson-projector.js')

const ledPin = 23
const infraredSensor = new Gpio(17, { mode: Gpio.INPUT, alert: true })
new Gpio(ledPin, { mode: Gpio.OUTPUT })

let lastTick = pigpio.getTick()
let pulse = []

pigpio.waveClear()
console.log(`Max wave length, pulses: ${pigpio.waveGetMaxPulses()}`)
console.log(`Max wave length, uS: ${pigpio.waveGetMaxMicros()}`)
console.log(`Max control blocks: ${pigpio.waveGetMaxCbs()}`)

const maxGap = 15000 // in uS; needs to be longer than the 9000 uS of the NEC start block
let timeoutHandle

infraredSensor.on('alert', (level, tick) => {
  if (pigpio.waveTxBusy()) {
    console.log('Seeing our own transmit...')
    return
  }

  const duration = pigpio.tickDiff(lastTick, tick) // in uS
  lastTick = tick

  if (pulse.length === 0 && level === 1 && is(duration, 9000)) {
    // starting a new NEC instruction
    console.log(`New command starting!`)
    pulse = [{ level, duration }]
  } else if (pulse.length === 67) {
    console.log(`Received a full NEC command.`)
    waveToNec(pulse)
    pulse = []
  } else if (pulse.length) {
    pulse.push({ level, duration })
  }

  if (timeoutHandle) clearTimeout(timeoutHandle)

  setTimeout(() => {
    const difference = pigpio.tickDiff(lastTick, pigpio.getTick())
    if (pulse.length === 67) {
      console.log(`Received a full NEC command.`)
      waveToNec(pulse)
    } else if (pulse.length && difference >= maxGap) {
      console.log(`Received an invalid NEC command with ${pulse.length} pulses. Starting over...`)
      pulse = []
    }
    // why do we need this to be _ten times_ too long to work? not a single clue!
  }, maxGap/1000*10) // convert to uS
})

console.log(`Listening for new infrared pulses...`)

standby(pigpio)


module.exports = {}
