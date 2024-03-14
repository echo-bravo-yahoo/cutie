const { BitAware } = require('./BitAware.js')
const { Classes, specialize_with } = require('../helpers.js')

class BitArray extends BitAware {
  constructor(number, lsbFirst, flipLogic) {
    super(lsbFirst, flipLogic)
    this.logical = BitArray.toBitArray(number)
  }

  static toBitArray(number, width=8) {
    let bitArray = []
    for(let i = width - 1; i >= 0; i--) {
      const bit = (Math.pow(2, i) & number) ? true : false
      bitArray.push(bit)
    }
    return bitArray
  }

  // returns a copy of bitArray
  static bitwiseReverse(bitArray, sourceName='logical') {
    return [...bitArray][sourceName].reverse()
  }

  static bitwiseFlip(bitArray, sourceName='logical') {
    return bitArray[sourceName].map((bit) => !!bit)
  }

  // mutates source, chainable
  bitwiseReverse(sourceName='logical') {
    this[sourceName].reverse()
    return this
  }

  // mutates source, chainable
  bitwiseFlip(sourceName='logical') {
    this[sourceName] = this[sourceName].map((bit) => !bit)
    return this
  }

  toNumber(width=8) {
    let number = 0
    for(let i = 0 ; i < width; i++) {
      number += this.logical[i] ? Math.pow(2, width - i - 1) : 0
    }

    return number
  }
}

module.exports = {
  BitArray
}
