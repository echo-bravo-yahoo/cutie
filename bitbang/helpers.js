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

function bitStringToArray(bitString) {
  return [...bitString].map((bit) => bit === '1')
}

function bitStringToNumber(bitString) {
  return arrayToNumber(bitStringToArray(bitString))
}

function arrayToNumber(bitArray, width) {
  number = 0
  for(let i = 0; i < (width || 32); i++) {
    number += Number(bitArray[i]) ? Math.pow(2, i) : 0
  }
  return number
}

module.exports = exports = {
  arrayToNumber,
  arrayToBitString,
  bitStringToArray,
  bitStringToNumber,
  numberToBitArray,
  numberToBitString
}
