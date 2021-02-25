const pigpio = require('pigpio')
const Gpio = pigpio.Gpio
const pin = 16

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

  pigpio.waveClear()
  pigpio.waveAddGeneric([{ gpioOn: pin, gpioOff: 0, usDelay: Math.round(usDelay * dutyCycle) }])
  const onWaveId = pigpio.waveCreate()
  pigpio.waveAddGeneric([{ gpioOn: 0, gpioOff: pin, usDelay: Math.round(usDelay * (1 - dutyCycle)) }])
  const offWaveId = pigpio.waveCreate()
  console.log(onWaveId)
  console.log(offWaveId)
  return [
    255, 0,            // start a wave
    onWaveId,          // send the "on" part of the pulse
    offWaveId,         // send the "off" part of the pulse
    255, 1, cycles, 0  // repeat the wave cycles times
  ]
}

function waveOff(duration) {
  pigpio.waveClear()
  pigpio.waveAddGeneric([{ gpioOn: 0, gpioOff: pin, usDelay: duration }])
  const waveId = pigpio.waveCreate()
  console.log(waveId)
  return [waveId]
}

async function sendMessage(messages) {
  // do we need to do this?
  // it takes FOREVER to turn the LED on and off for the first time, so let's do that as part of setup

  const high = 270
  const lowLong = 1000
  const lowShort = 200
  const waves = []

  for (let index = 0; index < messages.length; index++) {
    const bits = numberToBitArray(messages[index], 8)

    for(let index = 0; index < bits.length; index++) {
      waves.push(...waveFromSeparator(high))

      if(bits[index]) {
        waves.push(...waveOff(lowLong))
      } else {
        waves.push(...waveOff(lowShort))
      }
    }
  }
  waves.push(...waveFromSeparator(high))
  waves.push(...waveOff(lowShort))
  console.log(waves.length)
  console.log(JSON.stringify(waves))
  pigpio.waveChain(waves)
  while (pigpio.waveTxBusy()) {}
  console.log('DONE')
}

(async() => {
  // ok, good to go
  await sendMessage([
    // 0x11, 0xda, 0x27, 0x00, 0x00, 0x49, 0x2C, 0x00, 0x5F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x66
    0x11
  ])
})()

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
