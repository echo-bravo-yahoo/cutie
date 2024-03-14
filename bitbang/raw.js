const { is } = require('./helpers.js')

let lastTick
let pulse = []
const maxGap = 15000 // in uS; needs to be longer than the 9000 uS of the NEC start block
let timeoutHandle

function waveToRaw(wave) {
  const durations = wave.map((segment, index) => {
    return segment.duration
  })

  console.log(JSON.stringify(durations))
}

function rawListener(level, tick, pigpio) {
  if (lastTick === undefined) lastTick = pigpio.getTick()

  if (pigpio.waveTxBusy()) {
    console.log('Seeing our own transmit...')
    return
  }

  const duration = pigpio.tickDiff(lastTick, tick) // in uS
  lastTick = tick

  if (pulse.length === 0 && level === 1) {
    // starting a new raw instruction
    console.log(`New command starting!`)
    pulse = [{ level, duration }]
  } else if (pulse.length) {
    pulse.push({ level, duration })
  }

  if (timeoutHandle) clearTimeout(timeoutHandle)

  timeoutHandle = setTimeout(() => {
    // const difference = pigpio.tickDiff(lastTick, pigpio.getTick())
    console.log(`Received a full raw command with ${pulse.length} pulses.`)
    waveToRaw(pulse)
    pulse = []
    // why do we need this to be _ten times_ too long to work? not a single clue!
  }, maxGap/1000*10) // convert to uS
}

module.exports = {
  rawListener
}
