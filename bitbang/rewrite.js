const { performance } = require('perf_hooks')

const pigpio = require('pigpio')
const Gpio = pigpio.Gpio

const infraredLED = new Gpio(23, { mode: Gpio.OUTPUT })
const infraredSensor = new Gpio(17, { mode: Gpio.INPUT, alert: true })

let lastTick = 0
let pulse = []
let endTimeout

infraredSensor.on('alert', (level, tick) => {
  if (lastTick !== 0) {
    pulse.push({ level, duration: (lastTick - (tick >> 0))/1000 /* in mS, not uS */ })
  }
  lastTick = tick

  if (endTimeout) clearTimeout(endTimeout)

  endTimeout = setTimeout(() => {
    logPulse(pulse)
    pulse = []
    lastTick = 0
  }, 1000)
})

function logPulse(pulse) {
  console.log(`New instruction with ${pulse.length} pulses.`)
  for (let i = 0; i < pulse.length; i++) {
    console.log(`${pulse[i].level === 1 ? 'ON' : 'OFF'} for ${pulse[i].duration}.`)
  }
}
