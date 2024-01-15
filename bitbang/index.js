const pigpio = require('pigpio')
const Gpio = pigpio.Gpio
// const fs = require('fs')

const { waveToNec, is, necToWave, highWaveFromDuration, lowWaveFromDuration } = require('./nec.js')

const ledPin = 23
const infraredSensor = new Gpio(17, { mode: Gpio.INPUT, alert: true })
new Gpio(ledPin, { mode: Gpio.OUTPUT })

let lastTick = pigpio.getTick()
let pulse = []
// let expectedCSV = 'On,Duration\n'
// let actualCSV = 'On,Duration\n'

pigpio.waveClear()
console.log(`Max wave length, pulses: ${pigpio.waveGetMaxPulses()}`)
console.log(`Max wave length, uS: ${pigpio.waveGetMaxMicros()}`)
console.log(`Max control blocks: ${pigpio.waveGetMaxCbs()}`)

const maxGap = 15000 // in uS; needs to be longer than the 9000 uS of the NEC start block
let timeoutHandle

infraredSensor.on('alert', (level, tick) => {
  const duration = pigpio.tickDiff(lastTick, tick) // in uS
  lastTick = tick

  if (pulse.length === 0 && level === 1 && is(duration, 9000)) {
    // starting a new NEC instruction
    console.log(`New command starting!`)
    pulse = [{ level, duration }]
  } else if (pulse.length === 67) {
    console.log(`Received a full NEC command.`)
    waveToNec(pulse)
    // transmitPulse(pulse)
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

console.log(`Periodically transmitting volume - command.`)
const wave = necToWave(0x7c, 0x66, 0xaa)
pigpio.waveAddGeneric(wave)
const waveId = pigpio.waveCreate()
// fs.writeFileSync('./actual.csv', actualCSV)
// fs.writeFileSync('./expected.csv', expectedCSV)

setInterval(() => {
  console.log(`Transmitting new wave (${pigpio.waveGetMicros()} uS duration).`)
  pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT)
  checkWave()
}, 5000)

async function transmitNECCommand(pigpio, address, command, extendedAddress, extendedCommand) {
  return new Promise((resolve, reject) => {
    pigpio.waveAddGeneric(necToWave(address, command, extendedAddress, extendedCommand))
    const waveId = pigpio.waveCreate()
    // TODO: figure out why WAVE_MODE_ONE_SHOT_SYNC binds things up - it would be really helpful...
    pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT)
    checkWave(resolve.bind(null, waveId))
  })
}

function checkWave(cb) {
  setImmediate(() => {
    if (!pigpio.waveTxBusy()) {
      cb()
    } else {
      setImmediate(checkWave.bind(this, cb))
    }
  })
}

function transmitPulse(pulse) {
  let wavePulses = []
  pulse.forEach((segment) => {
    // expectedCSV += `${segment.level},${0}\n`
    // expectedCSV += `${segment.level},${segment.duration}\n`

    if (segment.level === 0) {
      wavePulses = lowWaveFromDuration(segment.duration, wavePulses)
    } else {
      wavePulses = highWaveFromDuration(segment.duration, wavePulses)
    }
  })

  pigpio.waveAddGeneric(wavePulses)
  const waveId = pigpio.waveCreate()
  // fs.writeFileSync('./actual.csv', actualCSV)
  // fs.writeFileSync('./expected.csv', expectedCSV)

  setInterval(() => {
    console.log(`Transmitting new wave (expected length ${pulse.reduce((sum, current) => sum + current.duration, 0)}, actual length ${pigpio.waveGetMicros()}).`)
    pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT)
    checkWave()
  }, 5000)
}

function checkWave() {
  setImmediate(() => {
    if (!pigpio.waveTxBusy()) {
      console.log(`Done transmitting.`)
    } else {
      setImmediate(checkWave)
    }
  })
}

module.exports = {
  transmitNECCommand
}
