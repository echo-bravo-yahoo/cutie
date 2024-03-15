const { BitArray } = require('./BitArray.js')
const { BitAware } = require('./BitAware.js')

class Byte extends BitAware {
  constructor(numberOrBitArray, lsbFirst, flipLogic) {
    super(lsbFirst, flipLogic)

    if (numberOrBitArray instanceof Byte) {
      return numberOrBitArray
    } else if (numberOrBitArray instanceof BitArray) {
      this.logical = numberOrBitArray.toNumber()
    } else if (typeof numberOrBitArray === 'number') {
      this.logical = numberOrBitArray
    } else if (typeof numberOrBitArray === 'string') {
      this.logical = parseInt(numberOrBitArray)
    } else {
      console.log(numberOrBitArray instanceof Number)
      throw new Error(`Cannot convert this (${numberOrBitArray}, ${JSON.stringify(numberOrBitArray)} ${typeof numberOrBitArray}) into a Byte.`)
    }
  }

  static bitwiseReverse(number) {
    return (new BitArray(number)).bitwiseReverse().toNumber()
  }

  static bitwiseFlip(number) {
    return (new BitArray(number)).bitwiseFlip().toNumber()
  }

  // mutates source, chainable
  bitwiseReverse(sourceName='logical') {
    this[sourceName] = (new BitArray(this[sourceName])).bitwiseReverse().toNumber()
    return this
  }

  bitwiseFlip(sourceName='logical') {
    this[sourceName] = (new BitArray(this[sourceName])).bitwiseFlip().toNumber()
    return this
  }

  toNumber() {
    return this.logical
  }

  getBit(index) {
    return this.logical[index]
  }

  slice(start, end) {
    return (new BitArray(this.logical).slice(start, end))
  }

  equals(byteOrNumber) {
    if (typeof byteOrNumber.toNumber === 'function')
      return this.toNumber() === byteOrNumber.toNumber()
    return this.toNumber() === byteOrNumber
  }

  toString(format='dec', sourceName='logical') {
    if (format === 'dec' || format === 'decimal') {
    return `${this[sourceName].toString()}`
    } else if (format === 'hex' || format === 'hexadecimal') {
    return `0x${this[sourceName].toString(16)}`
    } else if (format === 'bit' || format === 'bitstring') {
      return (new BitArray(this[sourceName]).logical.map((bit) => bit ? '1' : '0')).join('')
    } else if (format === 'all') {
      return `${this.toString('bit', sourceName)} (${this.toString('hex', sourceName)}, ${this.toString('dec', sourceName)}d)`
    }
  }
}

module.exports = {
  Byte
}
