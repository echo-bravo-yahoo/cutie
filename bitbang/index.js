const io = require('rpio')
const utime = require('microtime')
const { promisify } = require('util')
const sleep = io.usleep

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

async function numberToActions(number, width) {
  const bits = numberToBitArray(number, width)
  console.log(arrayToBitString(bits))
  const high = 270
  const lowLong = 1000
  const lowShort = 200

  for(let index = 0; index < bits.length; index++) {
    let before = utime.now()
    io.write(16, io.HIGH)
    let after = utime.now()
    sleep(high - (after - before))
    after = utime.now()
    console.log('LED ON for', after - before, 'microseconds')

    if(bits[index]) {
      before = utime.now()
      io.write(16, io.LOW)
      after = utime.now()
      sleep(lowLong - (after - before))
      after = utime.now()
      console.log('LED LONG OFF for', after - before, 'microseconds')
    } else {
      before = utime.now()
      io.write(16, io.LOW)
      after = utime.now()
      sleep(lowShort - (after - before))
      after = utime.now()
      console.log('LED SHORT OFF for', after - before, 'microseconds')
    }
  }
}

async function messageToActions(messages) {
  for (let index = 0; index < messages.length; index++) {
    await numberToActions(messages[index], 8)
  }
  // console.log('LED ON for', 500, 'microseconds')
  io.write(16, io.HIGH)
  sleep(500)
  io.write(16, io.LOW)
  io.close(16)
  console.log('DONE')
}

(async() => {
  // it takes FOREVER to turn the LED on and off for the first time, so let's do that as part of setup
  io.open(16, io.OUTPUT)
  io.write(16, io.HIGH)
  io.write(16, io.LOW)
  sleep(10000)

  // ok, good to go
  await messageToActions([
    0x11, 0xda, 0x27, 0x00, 0x00, 0x49, 0x2C, 0x00, 0x5F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x66
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
