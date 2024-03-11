const { bitArrayToByte, bytesToBitArray, highWaveFromDuration, lowWaveFromDuration, is, readByte, graphToTerminal, simpleWaveFromDuration, writeGeneratedCSV } = require('./helpers.js')
const { checkWave } = require('./pulse.js')

const readMitsubishiByte = (array, startIndex) => readByte(array, startIndex, false, 450, 1275)

const { writeFileSync } = require('fs')
const { resolve } = require('path')

let recordedCSV = ''
let hasRecorded = false
function writeRecordedCSV() {
  if (!hasRecorded) {
    writeFileSync(resolve(__dirname, './recorded.csv'), recordedCSV)
    hasRecorded = true
  }
}

function heat(pigpio) {
  const command = ["0x23","0xcb","0x26","0x1","0x0","0x20","0x8","0x7","0x30","0x7c","0x0","0x0","0x0","0x0","0x0","0x0","0x0","0xf0","0x23","0xcb","0x26","0x1","0x0","0x20","0x8","0x7","0x30","0x7c","0x0","0x0","0x0","0x0","0x0","0x0","0x0","0xf0"]


  return transmitMitsubishiCommand(pigpio, command)
}

function mitsubishiToWave(byteArray, simple) {
  console.log('    mitsubishiToWave: ' + byteArray.reduce((string, next) => string += ` ${next}`, '').trim())
  let low, high
  if (simple) {
    low = simpleWaveFromDuration.bind(null, false)
    high = simpleWaveFromDuration.bind(null, true)
  } else {
    low = lowWaveFromDuration
    high = highWaveFromDuration
  }

  console.log('First byte', byteArray[0])
  const bits = bytesToBitArray(byteArray, false)

  // the first two waves are the Mitsubishi start header
  // the last wave signals the end of transmission
  let wave = [
    high(3500),
    low(1750)
  ]

  // we'll need new headers at bit 291
  for (let i = 0; i < 144; i++) {
    wave.push(high(450))
    //if (simple) {
      wave.push(low(bits[i] ? 1275 : 450 ))
    //} else {
      //wave.push(low(bits[i] ? 450 : 1275 ))
    //}
  }

  wave.push(high(450))
  wave.push(low(17000))
  wave.push(high(3500))
  wave.push(low(1750))

  for (let i = 144; i < bits.length; i++) {
    wave.push(high(450))
    //if (simple) {
      wave.push(low(bits[i] ? 1275 : 450 ))
    //} else {
      //wave.push(low(bits[i] ? 450 : 1275 ))
    //}
  }

  wave.push(high(450))

  return wave.flat(Infinity)
}

// TODO: This function (and its cousin in nec.js) are a hot mess
// Should just splice out wave[0] and wave[1] instead of all the complex logic
function waveToMitsubishiAC(wave) {
  if (!wave[0] || wave[0].level !== 1 || is(wave[0], 3500))
    throw new Error(`First pulse should be high for 3500 uS.\n\nSegments: ${JSON.stringify(wave, null, 2)}`)

  if (!wave[1] || wave[1].level !== 0 || is(wave[1], 1700))
    throw new Error(`Second pulse should be low for 1700 uS.\n\nSegments: ${JSON.stringify(wave, null, 2)}`)

  wave.forEach((segment, index) => {
    recordedCSV += `${segment.level},${0}\n`
    recordedCSV += `${segment.level},${segment.duration}\n`
    // HIGH level separators, LOW level encoded
    // there's a HIGH divider halfway through with a value of 3620...
    if (index !== 0 && index !== 1 && segment.level === 1 && !is(segment.duration, 450) && !is(segment.duration, 3620))
      throw new Error(`Seperator at index ${index} is not the expected size (450); was actually ${segment.duration}.\n\nSegments: ${JSON.stringify(wave)}`)
  })

  // there's a 17,000 ms LOW at index 112 and 145
  // also, have to lower tolerance on is, because 1700 separator and 1200 HIGH data collide
  // TODO: simplify; this is here and in transmitMitsubishiCommand
  let durations = wave.filter((segment) => segment.level === 0 && !is(segment.duration, 1700, .16) && !is(segment.duration, 17000)).map((segment) => segment.duration)

  try {
    console.log(`Received Mitsubishi AC command:`)
    let command = []
    const lastByteIndex = Math.ceil((durations.length)/8)
    for(let i = 0; i < lastByteIndex; i++) {
      const by = readMitsubishiByte(durations, 8*i)
      if (i === lastByteIndex) {
        console.log(`total durations: ${durations.length}, byteCount: ${(durations.length - 1)/8}, byte index: ${i}, durations remaining: ${durations.length - i*8}`)
      }
      // console.log(`  Raw Byte ${i + 1}: ${JSON.stringify(durations.slice(1 + 8*i, 1 + 8*(i+1)))}`)
      // console.log(`      Byte ${i + 1}: ${JSON.stringify(by)} (${bitArrayToByte(by)}, 0x${bitArrayToByte(by).toString(16)})`)
      command.push(`0x${bitArrayToByte(by).toString(16)}`)
    }
    // console.log(`const command = ${JSON.stringify(command)}`)
    console.log(`    readMitsubishiByte: ${command.join(' ').trim()}`)
    console.log(`    const command = ${JSON.stringify(command)}`)
    console.log(`First 10 durations: ${JSON.stringify(wave.slice(0, 10))}`)
    console.log(graphToTerminal(wave, [
      { duration: 1275, tolerance: .14 },
      { duration: 450 },
      { duration: 3500 },
      { duration: 17000 },
      { duration: 1700, tolerance: .14 },
    ]))
    writeRecordedCSV()
  } catch (e) {
    console.log(`Segments: ${JSON.stringify(wave)}`)
    throw e
  }
}

async function transmitMitsubishiCommand(pigpio, byteArray) {
  pigpio.waveClear()

  return new Promise((resolve, reject) => {
    console.log(`Sending Mitsubishi AC command:`)
    const wave = mitsubishiToWave(byteArray)
    // const filteredWave = wave.filter((segment) => segment.level === 0 && !is(segment.duration, 1700, .16) && !is(segment.duration, 17000)).map((segment) => segment.duration)
    console.log(`First 10 transmit durations: ${JSON.stringify(mitsubishiToWave(byteArray, true).slice(0, 10))}`)
    console.log(graphToTerminal(mitsubishiToWave(byteArray, true), [
      { duration: 1275, tolerance: .14 },
      { duration: 450 },
      { duration: 3500 },
      { duration: 17000 },
      { duration: 1700, tolerance: .14 },
    ]))
    writeGeneratedCSV()
    pigpio.waveAddGeneric(wave)
    const waveId = pigpio.waveCreate()
    // TODO: figure out why WAVE_MODE_ONE_SHOT_SYNC binds things up - it would be really helpful...
    const start = performance.now()
    pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT)
    checkWave(pigpio, () => {
      const end = performance.now()
      console.log(`Transmission took ${(end - start) * Math.pow(10, 3)} uS`)
      resolve()
    })
  })
}

let lastTick
let pulse = []
const maxGap = 15000 // in uS; needs to be longer than the 9000 uS of the NEC start block
let timeoutHandle
const pulseCount = 583


function mitsubishiListener(level, tick, pigpio) {
  if (lastTick === undefined) lastTick = pigpio.getTick()

  if (pigpio.waveTxBusy()) {
    // console.log('Seeing our own transmit...')
    return
  }

  const duration = pigpio.tickDiff(lastTick, tick) // in uS
  lastTick = tick

  if (pulse.length === 0 && level === 1 && is(duration, 3450)) {
    // starting a new Mitsubishi instruction
    console.log(`New Mitsubishi command starting!`)
    pulse = [{ level, duration }]
  } else if (pulse.length === pulseCount) {
    // console.log(`Received a full Mitsubishi command.`)
    waveToMitsubishiAC(pulse)
    pulse = []
  } else if (pulse.length) {
    pulse.push({ level, duration })
  }

  if (timeoutHandle) clearTimeout(timeoutHandle)

  timeoutHandle = setTimeout(() => {
    const difference = pigpio.tickDiff(lastTick, pigpio.getTick())
    if (pulse.length === pulseCount) {
      // console.log(`Received a full Mitsubishi command.`)
      waveToMitsubishiAC(pulse)
      heat(pigpio)
    } else if (pulse.length && difference >= maxGap) {
      console.log(`Received an invalid Mitsubishi command with ${pulse.length} pulses. Starting over...`)
      pulse = []
    }
    // why do we need this to be _ten times_ too long to work? not a single clue!
  }, maxGap/1000*10) // convert to uS
}

module.exports = {
  waveToMitsubishiAC,
  is,
  heat,
  transmitMitsubishiCommand,
  mitsubishiListener
}

