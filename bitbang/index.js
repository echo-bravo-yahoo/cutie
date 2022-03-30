const { numberToBitArray } = require('./helpers')
const pin = 23
const argsOpts = { configuration: { 'strip-dashed': true }, boolean: ['fanSwing', 'powerful', 'econo', 'virtual'] }
let args = require('yargs-parser')(process.argv.slice(2), argsOpts)
let pigpio, Gpio, output

if (args.virtual === undefined || args.virtual === false) {
  pigpio = require('pigpio')
  Gpio = pigpio.Gpio
  output = new Gpio(pin, { mode: Gpio.OUTPUT })
}


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
  console.log('Message sent.')
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
  } else if (mode === 'OFF') {
    return 0x00
  } else {
    throw `Unsupported mode ${mode}, should be one of AUTO, DRY, COLD, HEAT, FAN, OFF.`
  }
}

function getTemp(tempInF) {
  if (tempInF === undefined) throw `Invalid temp ${tempInF}, should be a number.`
  const tempInC = 5/9 * (tempInF - 32)
  return Math.round(tempInC * 2)
}

function getFan(fanMode, fanSwing) {
  let firstChar, secondChar;
  if (typeof fanMode === 'number' && fanMode >= 0 && fanMode < 6) {
    firstChar = String(fanMode + 2)
  } else if (fanMode === 'AUTO') {
    firstChar = 'A'
  } else if (fanMode === 'SILENT') {
    firstChar = 'B'
  } else {
    throw `Unsupported fan mode ${fanMode}, should be one of 0, 1, 2, 3, 4, 5, AUTO, SILENT.`
  }

  if (fanSwing === true || fanSwing === 'true') {
    secondChar = 'F'
  } else if (fanSwing === false || fanSwing === 'false') {
    secondChar = '0'
  } else {
    throw `Unsupported fan swing ${fanSwing}, should be one of true, false.`
  }

  return parseInt(`${firstChar}${secondChar}`, 16)
}

function getPowerful(powerful) {
  if (powerful === true || powerful === 'true') {
    return 0x01
  } else if (powerful === false || powerful === 'false') {
    return 0x00
  } else {
    throw `Unsupported powerful setting ${powerful}, should be one of true, false.`
  }
}

function getEcoComfort(econo, comfort, mode) {
  let res = 0
  // unimplemented remote quirk: if POWER is true, ECONO is always set to zero

  if (typeof econo !== 'boolean' && econo !== 'false' && econo !== 'true') {
    throw `Unsupported econo setting ${econo}, should be one of true, false.`
  }

  if (typeof comfort !== 'boolean' && comfort !== 'false' && comfort !== 'true') {
    throw `Unsupported comfort setting ${comfort}, should be one of true, false.`
  }

  if (mode === 'OFF') {
    return 0x20
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

function buildMessage({ mode, temp, fanMode, fanSwing, powerful, econo, comfort }) {
  // start with the header and message id
  let message
  if (mode === 'OFF') {
    message = [0x8, 0xed, 0x13, 0x00, 0x00]
  } else {
    message = [0x11, 0xda, 0x27, 0x00, 0x00]
  }

  // then the mode
  message.push(getMode(mode))

  // then the temp
  message.push(getTemp(temp))

  // then a fixed section
  message.push(0x00)

  // then the fan info
  message.push(getFan(fanMode, fanSwing))

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
  if (mode == 'OFF') {
    message.push(0x80)
    message.push(0x62)
  } else {
    message.push(0x00)
    message.push(0xc5)
  }

  // then economy info
  message.push(getEcoComfort(econo, comfort, mode))

  // then a fixed section
  message.push(0x00)

  // then the checksum
  message.push(getChecksum(message))

  return message
}

function logMessage(message) {
  console.log(message.map(num => Number(num).toString(16)).join(', '))
}

if (args.virtual === undefined || args.virtual === false) {
  if (args["obj"]) args = JSON.parse(args.obj)
  console.log('Sending message:')
  logMessage(buildMessage(args))
  sendMessage(buildMessage(args))
} else {
  if (args["obj"]) args = JSON.parse(args.obj)
  console.log('Running in virtual mode, won\'t send message:')
  logMessage(buildMessage(args))
}

// logMessage(buildMessage(args))

// this message works perfectly
// logMessage(buildMessage({ mode: 'HEAT', temp: 72, fan: { mode: 5, swing: true }, powerful: false, econo: false }))

// try these messages next
// logMessage(buildMessage({ mode: 'HEAT', temp: 78, fan: { mode: 1, swing: false }, powerful: true, econo: true }))
// logMessage(buildMessage({ mode: 'DRY', temp: 75, fan: { mode: 'SILENT', swing: true }, powerful: false, econo: true }))
// logMessage(buildMessage({ mode: 'COLD', temp: 68, fan: { mode: 'AUTO', swing: false }, powerful: true, econo: false }))
// logMessage(buildMessage({ mode: 'AUTO', temp: 72, fan: { mode: 2, swing: false }, powerful: false, econo: true }))
// logMessage(buildMessage({ mode: 'FAN', temp: 70, fan: { mode: 4, swing: true }, powerful: true, econo: true }))
