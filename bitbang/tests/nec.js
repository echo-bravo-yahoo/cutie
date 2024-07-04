const sinon = require("sinon")
const { necToBits } = require('../adapters/nec')
const { numberToBitArray } = require('../helpers')
const test = require('tape');

test('NEC encoder', t => {
  t.test('converts volume down command (0x5583, 0x6699) correctly', (t) => {
    const input = {
      necAddress: '0x55',
      extendedNecAddress: '0x83',
      necCommand: '0x66'
    }

    const expected = [
      numberToBitArray(input.necAddress, 8),
      numberToBitArray(input.extendedNecAddress, 8),
      numberToBitArray(input.necCommand, 8),
      numberToBitArray('0x99', 8) // complement of input.necCommand
    ].flat(Infinity).map((bit) => bit ? '1' : '0').join('')

    const bits = necToBits(input).map((bit) => bit ? '1' : '0').join('')
    t.equal(bits, expected)
    t.end()
  })

  t.test('converts standby command (0x5583, 0x6E91) correctly', (t) => {
    const input = {
      necAddress: '0x55',
      extendedNecAddress: '0x83',
      necCommand: '0x6E',
      logger: console.log
    }

    const expected = [
      numberToBitArray(input.necAddress, 8),
      numberToBitArray(input.extendedNecAddress, 8),
      numberToBitArray(input.necCommand, 8),
      numberToBitArray('0x91', 8) // complement of input.necCommand
    ].flat(Infinity).map((bit) => bit ? '1' : '0').join('')

    const bits = necToBits(input).map((bit) => bit ? '1' : '0').join('')
    t.equal(bits, expected)
    t.end()
  })
});
