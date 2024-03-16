const { Byte } = require('./Byte.js')
const { BitAware } = require('./BitAware.js')
const { BitArray } = require('./BitArray.js')

class ByteArray extends BitAware {
  constructor(byteArray, lsbFirst, flipLogic) {
    super(lsbFirst, flipLogic)
    this.logical = []
    this.push(byteArray)
  }

  bitwiseReverse(sourceName='logical') {
    this[sourceName].forEach((byte) => byte.bitwiseReverse(sourceName))
    return this
  }

  bitwiseFlip(sourceName='logical') {
    this[sourceName].forEach((byte) => byte.bitwiseFlip(sourceName))
    return this
  }

  get(index) {
    return this.logical[index]
  }

  slice(start, end) {
    return new ByteArray(this.logical.slice(start, end))
  }

  equals(byteArray) {
    if (byteArray.logical) byteArray = byteArray.logical
    if (this.logical.length !== byteArray.length)
      return false
    for (let i = 0; i < this.logical.length; i++) {
      if (!this.logical[i].equals(byteArray[i]))
        return false
    }
    return true
  }

  makeValidByte(byteish) {
    if (byteish instanceof Byte)
      return byteish
    if (byteish instanceof BitArray) {
      if (byteish.logical.length !== 8)
        throw new Error(`Attempted to coerce BitArray (${byteish.toString(all)}) to a byte with width 8, but do not know what to do with the missing bits.`)
      return new Byte(byteish)
    }
    if (typeof byteish === 'string') {
      return new Byte(byteish)
    }
    if (typeof byteish === 'number') {
      // TODO: validate over/underflow?
      return new Byte(byteish)
    }
  }

  toBitArray(sourceName='logical') {
    return this[sourceName].reduce((allBits, nextByte) => {
      const theseBits = nextByte.toBitArray().logical
      return [ ...allBits, ...theseBits ]
    }, [])
  }

  push(byteOrBytes) {
    // TODO: validation...
    if (byteOrBytes instanceof Array) {
      byteOrBytes.forEach((byteish) => this.logical.push(this.makeValidByte(byteish)))
    } else {
      this.logical.push(this.makeValidByte(byteOrBytes))
    }
  }

  toNumber(...args) {
    return this.logical.map((byte) => byte.toNumber(...args))
  }

  toString(...args) {
    return this.logical.map((byte) => byte.toString(...args))
  }

  sum(sourceName='logical') {
    return this[sourceName].reduce((sum, nextByte) => sum + nextByte.toNumber(), 0)
  }

  checksum(sourceName='logical') {
    const checksum = this.sum(sourceName) % 256
    if (isNaN(checksum))
      throw new Error(`Computed checksum was NaN for byteArray ${this.toString('all')}.`)

    return checksum
  }
}

module.exports = {
  ByteArray
}
