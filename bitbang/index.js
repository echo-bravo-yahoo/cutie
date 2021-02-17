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
    await sleep(high)

    if(bits[index]) {
      console.log('LED OFF for', lowLong, 'microseconds')
      await sleep(lowLong)
    } else {
      console.log('LED OFF for', lowShort, 'microseconds')
      await sleep(lowShort)
    }
  }
}


console.log(numberToBitString(0x11, 8))
numberToActions(0x11, 8).then(() => {
  console.log('LED ON for', 500, 'microseconds')
  sleep(500)
  console.log('DONE')
})

// manual: https://www.daikinac.com/content/assets/DOC/OperationManuals/01-EN-3P379751-4C.pdf
// comfort mode: blows up for cool, down for heat 'avoid blowing on you'
// econo: lower power use
// powerful: 20 minutes of max (AC, heat), then return to previous settings
  // mai
