const { BitArray } = require('./BitArray.js')
const { BitAware } = require('./BitAware.js')

class Byte extends BitAware {
  constructor(number, lsbFirst, flipLogic) {
    super(lsbFirst, flipLogic)
    this.logical = number
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

  toString(format='dec', sourceName='logical') {
    if (format === 'dec' || format === 'decimal') {
    return `${this[sourceName].toString()}`
    } else if (format === 'hex' || format === 'hexadecimal') {
    return `0x${this[sourceName].toString(16)}`
    } else if (format === 'bit' || format === 'bitstring') {
      return (new BitArray(this[sourceName]).logical.map((bit) => bit ? '1' : '0')).join('')
    }
  }
}

module.exports = {
  Byte
}
