const { BitAware } = require('./BitAware.js')

// this stores an array of numbers (1s and 0s)
// almost certainly less memory efficient than an array of booleans (trues and falses)
// but frankly, it's easier to work with right now
class BitArray extends BitAware {
  constructor(numberOrBitArray, width=8, lsbFirst, flipLogic) {
    super(lsbFirst, flipLogic)
    this.logical = numberOrBitArray.length ? numberOrBitArray : BitArray.toBitArray(numberOrBitArray, width)
  }

  overwrite(startIndex, bitArray) {
    // take either an array of bits, or a BitArray object
    if (bitArray.logical) bitArray = bitArray.logical

    for(let i = 0; i < bitArray.length; i++) {
      if (startIndex + i >= this.logical.length)
        throw new Error(`Overwrite operation with BitArray of length ${bitArray.length} starting at index ${startIndex} extends beyond current BitArray's last index (${this.logical.length - 1}.`)
      this.logical[startIndex + i] = bitArray[i] ? 1 : 0
    }
  }

  static toBitArray(number, width=8) {
    let bitArray = []
    for(let i = width - 1; i >= 0; i--) {
      const bit = (Math.pow(2, i) & number) ? 1 : 0
      bitArray.push(bit)
    }
    return bitArray
  }

  // returns a copy of bitArray
  static bitwiseReverse(bitArray, sourceName='logical') {
    return new BitArray(bitArray[sourceName].reverse())
  }

  static bitwiseFlip(bitArray, sourceName='logical') {
    return new BitArray(bitArray[sourceName].map((bit) => !bit))
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

  equals(bitArrayOrNumber) {
    if (typeof bitArrayOrNumber.toNumber === 'function')
      return this.toNumber() === bitArrayOrNumber.toNumber()
    if (bitArrayOrNumber instanceof Array)
      return this.toNumber() === (new BitArray(bitArrayOrNumber)).toNumber()
    return this.toNumber() === bitArrayOrNumber
  }

  slice(start, end) {
    const bits = this.logical.slice(start, end)
    return new BitArray(bits, bits.length)
  }

  static toNumber(bitArray, width=8) {
    let number = 0
    for(let i = 0 ; i < width; i++) {
      number += bitArray[i] ? Math.pow(2, width - i - 1) : 0
    }

    return number
  }

  toNumber(width=this.logical.length) {
    let number = 0
    for(let i = 0 ; i < width; i++) {
      number += this.logical[i] ? Math.pow(2, width - i - 1) : 0
    }

    return number
  }

  toString(format='dec', sourceName='logical') {
    if (format === 'dec' || format === 'decimal') {
    return `${parseInt(this[sourceName].join(''), 2).toString(10)}`
    } else if (format === 'hex' || format === 'hexadecimal') {
      return `0x${parseInt(this[sourceName].join(''), 2).toString(16)}`
    } else if (format === 'bit' || format === 'bitstring') {
      return this[sourceName].map((bit) => bit ? '1' : '0').join('')
    } else if (format === 'all') {
      return `${this.toString('bit', sourceName)} (${this.toString('hex', sourceName)}, ${this.toString('dec', sourceName)}d)`
    }
  }
}

module.exports = {
  BitArray
}
