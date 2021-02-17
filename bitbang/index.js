function sleep(time) {
  return new Promise((res) => {
    setTimeout(res, time/1000)
  })
}

function numberToBitArray(number, width) {
  let bitArray = []
  for(let i = 0; i < (width || 32); i++) {
    const bit = (Math.pow(2, i) & number) ? true : false
    // console.log(number, Math.pow(2, i), bit)
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
  const high = 500
  const lowLong = 1300
  const lowShort = 435

  for(let index = 0; index < bits.length; index++) {
    console.log('LED ON for', high, 'microseconds')
    await io.write(16, true)
    await sleep(high)

    if(bits[index]) {
      console.log('LED OFF for', lowLong, 'microseconds')
      await io.write(16, false)
      await sleep(lowLong)
    } else {
      console.log('LED OFF for', lowShort, 'microseconds')
      await io.write(16, false)
      await sleep(lowShort)
    }
  }
}

async function messageToActions(message) {
  await io.setup(16, io.DIR_OUT)

  for (let index = 0; index < message.length; index++) {
    await numberToActions(message, 8)
  }
  console.log('LED ON for', 500, 'microseconds')
  await io.write(16, true)
  sleep(500)
  await io.write(16, false)
  console.log('DONE')
}

(async() => {
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
