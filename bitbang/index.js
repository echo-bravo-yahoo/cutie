const pigpio = require('pigpio')
const Gpio = pigpio.Gpio
const pin = 23

const output = new Gpio(pin, { mode: Gpio.OUTPUT })

function numberToBitArray(number, width) {
  let bitArray = []
  for(let i = 0; i < (width || 32); i++) {
    const bit = (Math.pow(2, i) & number) ? true : false
    bitArray.push(bit)
  }
  return bitArray
}

function numberToBitString(number, width) {
  return arrayToBitString(numberToBitArray(number, width))
}

function arrayToBitString(bitArray) {
  return bitArray.map((bit) => bit ? '1' : '0').join('')
}

function arrayToNumber(bitArray, width) {
  number = 0
  for(let i = 0; i < (width || 32); i++) {
    number += Number(bitArray[i]) ? Math.pow(2, i) : 0
  }
  return number
}

function waveFromSeparator(duration, frequency=38000, dutyCycle=0.5) {
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
    lowShortWave,
    highWave,
    oddWave,
    highWave,
    weirdWave,
    highWave,
    lowLongWave,
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
    highWave,
    lowLongWave,
    highWave,
    lowShortWave,
    highWave,
    lowShortWave,
  ]
}

function sendMessage(messages) {
  const highWave = waveFromSeparator(462)
  console.log('separator', highWave)
  const lowLongWave = waveOff(1282)
  console.log('long', lowLongWave)
  const lowShortWave = waveOff(421)
  console.log('short', lowShortWave)
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
  console.log('micros', pigpio.waveGetMicros())
  console.log('highMicros', pigpio.waveGetHighMicros())
  console.log('maxMicros', pigpio.waveGetMaxMicros())
  console.log('pulses', pigpio.waveGetPulses())
  console.log('highPulses', pigpio.waveGetHighPulses())
  console.log('maxPulses', pigpio.waveGetMaxPulses())

  pigpio.waveChain(waves)
  while (pigpio.waveTxBusy()) {
    // console.log('Transmitting', pigpio.waveTxAt(), 'waveform')
  }
  console.log('DONE')
}

sendMessage([ 0x11, 0xda, 0x27, 0x00, 0x00, 0x49, 0x2C, 0x00, 0x5F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x66 ])

// "build a message from scratch"
// |   header    | Msg Id | Mode | Temp | Fixed | Fan | Fixed |  Timers  | Pwrful | Fixed | Econo | Fixed | Checksum |
// | 11 da 27 00 |   00   |  xx  |  xx  |   00  |  xx |   00  | xx xx xx |   0x   |   00  |   8x  |   00  |    xx    |
// "heat" at 72F, 3/5 fan speed, swing enabled
// | 11 da 27 00 |   00   |  49  |  2C  |   00  |  5F |   00  | 00 00 00 |   00   |   00  |   80  |   00  |    66    |

// manual: https://www.daikinac.com/content/assets/DOC/OperationManuals/01-EN-3P379751-4C.pdf
// comfort mode: blows up for cool, down for heat 'avoid blowing on you'
// econo: lower power use
// powerful: 20 minutes of max (AC, heat), then return to previous settings
  // mai
