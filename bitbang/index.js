const pigpio = require('pigpio')
const Gpio = pigpio.Gpio
// const fs = require('fs')

const { waveToNec } = require('nec.js')

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

const maxGap = 5000 // in uS
const cmdStart = [9000*.9, 9000*1.1]

infraredSensor.on('alert', (level, tick) => {
  const duration = pigpio.tickDiff(lastTick, tick) /* in uS */

  if (pulse.length && pigpio.tickDiff(lastTick, tick) >= maxGap) {
    console.log(`Command ended after ${pulse.length} pulses with a ${duration} gap since last pulse.`)
    done = true
    waveToNec(pulse)
    transmitPulse(pulse)
    pulse = []
  }

  if (pulse.length) {
  pulse.push({ level, duration })
  }

  if (duration >= cmdStart[0] && duration <= cmdStart[1]) {
    console.log(`New command starting!`)
    pulse.push({ level, duration })
  }

  lastTick = tick
})

console.log(`Listening for new infrared pulses...`)

function highWaveFromDuration(duration, wavePulses, frequency=38400, dutyCycle=0.5) {
  const usDelay = (1/frequency) * Math.pow(10, 6)
  const cycles = Math.round(duration * frequency / Math.pow(10, 6))
  const pulses = []

  for(let index = 0; index < cycles; index++) {
    pulses.push({ gpioOn: ledPin, gpioOff: 0, usDelay: Math.round(usDelay * dutyCycle) })
    pulses.push({ gpioOn: 0, gpioOff: ledPin, usDelay: Math.round(usDelay * (1 - dutyCycle)) })
  }

  // pulses.forEach((pulse) => actualCSV += `${pulse.gpioOn ? 1 : 0},${pulse.usDelay}\n`)

  return [...wavePulses, ...pulses]
}

function lowWaveFromDuration(duration, wavePulses) {

  // actualCSV += `0,${duration}\n`

  return [...wavePulses, { gpioOn: 0, gpioOff: ledPin, usDelay: duration }]
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
