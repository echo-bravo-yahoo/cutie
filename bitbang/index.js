const { numberToBitArray } = require('./helpers')
const pigpio = require('pigpio')
const Gpio = pigpio.Gpio
const pin = 23
const output = new Gpio(pin, { mode: Gpio.OUTPUT })

function waveFromSeparator(duration, frequency=38400, dutyCycle=0.5) {
  const usDelay = (1/frequency) * Math.pow(10, 6)
  const cycles = Math.round(duration * frequency / Math.pow(10, 6))
  const wave = []

  for(let index = 0; index < cycles; index++) {
    wave.push({ gpioOn: pin, gpioOff: 0, usDelay: Math.round(usDelay * dutyCycle) })
    wave.push({ gpioOn: 0, gpioOff: pin, usDelay: Math.round(usDelay * (1 - dutyCycle)) })
  }

  pigpio.waveAddGeneric(wave)
  return pigpio.waveCreate()
}

function waveOff(duration) {
  pigpio.waveAddGeneric([{ gpioOn: 0, gpioOff: pin, usDelay: duration }])
  return pigpio.waveCreate()
}

function header(highWave, lowShortWave, lowLongWave) {
  pigpio.waveAddGeneric([{ gpioOn: 0, gpioOff: pin, usDelay: 24976 }])
  const oddWave = pigpio.waveCreate()

  const oddSeparator = waveFromSeparator(3520)

  pigpio.waveAddGeneric([{ gpioOn: 0, gpioOff: pin, usDelay: 1727 }])
  const weirdWave = pigpio.waveCreate()

  return [
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
    highWave,
    oddWave,
    oddSeparator,
    weirdWave,
  ]
}

function sendMessage(messages) {
  const highWave = waveFromSeparator(430)
  const lowLongWave = waveOff(1310)
  const lowShortWave = waveOff(450)
  const waves = [...header(highWave, lowShortWave, lowLongWave)]

  for (let index = 0; index < messages.length; index++) {
    const bits = numberToBitArray(messages[index], 8)

    for(let index = 0; index < bits.length; index++) {
      waves.push(highWave)

      if(bits[index]) {
        waves.push(lowLongWave)
      } else {
        waves.push(lowShortWave)
      }
    }
  }

  waves.push(highWave)
  waves.push(lowShortWave)
  console.log(waves.length)
  console.log(JSON.stringify(waves))

  pigpio.waveChain(waves)
  while (pigpio.waveTxBusy()) {}
  console.log('DONE')
}

function getMode(mode) {
  if (mode === 'AUTO') {
    return 0x01
  } else if (mode === 'DRY') {
    return 0x21
  } else if (mode === 'COLD') {
    return 0x31
  } else if (mode === 'HEAT') {
    return 0x41
  } else if (mode === 'FAN') {
    return 0x61
  } else {
    throw `Unsupported mode ${mode}, should be one of AUTO, DRY, COLD, HEAT, FAN.`
  }
}

function getTemp(tempInF) {
  const tempInC = 5/9 * (tempInF - 32)
  return Math.round(tempInC) * 2
}

function getFan(fan = { mode: 3, swing: true }) {
  let firstChar, secondChar;
  if (typeof fan.mode === 'number' && fan.mode > 0 && fan.mode < 6) {
    firstChar = String(fan.mode + 2)
  } else if (fan.mode === 'AUTO') {
    firstChar = 'A'
  } else if (fan.mode === 'SILENT') {
    firstChar = 'B'
  } else {
    throw `Unsupported fan mode ${fan.mode}, should be one of 0, 1, 2, 3, 4, 5, AUTO, SILENT.`
  }

  if (fan.swing === true) {
    secondChar = 'F'
  } else if (fan.swing === false) {
    secondChar = '0'
  } else {
    throw `Unsupported fan swing ${fan.swing}, should be one of true, false.`
  }

  return parseInt(`${firstChar}${secondChar}`, 16)
}

function getPowerful(powerful) {
  if (powerful === true) {
    return 0x01
  } else if (powerful === false) {
    return 0x00
  } else {
    throw `Unsupported powerful setting ${powerful}, should be one of true, false.`
  }
}

function getEcoComfort(econo, comfort) {
  let res = 0
  // unimplemented remote quirk: if POWER is true, ECONO is always set to zero

  if (typeof econo !== 'boolean') {
    throw `Unsupported econo setting ${econo}, should be one of true, false.`
  }

  if (typeof comfort !== 'boolean') {
    throw `Unsupported comfort setting ${comfort}, should be one of true, false.`
  }

  if (econo === true) {
    res += 4
  } 

  if (comfort === true) {
    res += 2
  }

  return res
}

function getChecksum(message) {
  return 0xFF & message.reduce((sum, val) => sum + val, 0)
}

function buildMessage({ mode, temp, fan, powerful, econo, comfort }) {
  // start with the header and message id
  const message = [0x11, 0xda, 0x27, 0x00, 0x00]

  // then the mode
  message.push(getMode(mode))

  // then the temp
  message.push(getTemp(temp))

  // then a fixed section
  message.push(0x00)

  // then the fan info
  message.push(getFan(fan))

  // then a fixed section
  message.push(0x00)

  // then the timer info
  // NB: not implemented
  message.push(0x00)
  message.push(0x00)
  message.push(0x00)

  // then the powerful info
  message.push(getPowerful(powerful))

  // then fixed sections
  message.push(0x00)
  message.push(0xc5)

  // then economy info
  message.push(getEcoComfort(econo, comfort))

  // then a fixed section
  message.push(0x00)

  // then the checksum
  message.push(getChecksum(message))

  return message
}

function logMessage(message) {
  console.log(message.map(num => Number(num).toString(16)).join(', '))
}

// 11, da, 27, 0, 0, 41, 2c, 0, 7f, 0, 0, 0, 0, 0, 0, c5, 0, 0, c3
// sendMessage(buildMessage({ mode: 'HEAT', temp: 72, fan: { mode: 5, swing: true }, powerful: false, econo: false, comfort: false }))
// logMessage(buildMessage({ mode: 'HEAT', temp: 72, fan: { mode: 5, swing: true }, powerful: false, econo: false, comfort: false }))

// no canonical string - 78 rounds differently on the remote than in the code
// logMessage(buildMessage({ mode: 'HEAT', temp: 78, fan: { mode: 1, swing: false }, powerful: true, econo: true, comfort: false }))
// sendMessage(buildMessage({ mode: 'HEAT', temp: 78, fan: { mode: 1, swing: false }, powerful: true, econo: true, comfort: false }))

// quirk: if comfort, fan must be auto, swing false

// in dry mode, only fan swing, powerful, econo matter
// logMessage(buildMessage({ mode: 'DRY', temp: 75, fan: { mode: 'SILENT', swing: true }, powerful: false, econo: true, comfort: false }))
// sendMessage(buildMessage({ mode: 'DRY', temp: 75, fan: { mode: 'SILENT', swing: true }, powerful: false, econo: true, comfort: false }))

// logMessage(buildMessage({ mode: 'COLD', temp: 68, fan: { mode: 'AUTO', swing: false }, powerful: true, econo: false, comfort: false }))
// sendMessage(buildMessage({ mode: 'COLD', temp: 68, fan: { mode: 'AUTO', swing: false }, powerful: true, econo: false, comfort: false }))
// logMessage(buildMessage({ mode: 'AUTO', temp: 72, fan: { mode: 2, swing: false }, powerful: false, econo: true, comfort: false }))
// sendMessage(buildMessage({ mode: 'AUTO', temp: 72, fan: { mode: 2, swing: false }, powerful: false, econo: true, comfort: false }))
// logMessage(buildMessage({ mode: 'FAN', temp: 70, fan: { mode: 4, swing: true }, powerful: true, econo: true, comfort: false }))
// sendMessage(buildMessage({ mode: 'FAN', temp: 70, fan: { mode: 4, swing: true }, powerful: true, econo: true, comfort: false }))
