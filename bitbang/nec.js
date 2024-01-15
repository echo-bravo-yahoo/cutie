// https://exploreembedded.com/wiki/NEC_IR_Remote_Control_Interface_with_8051
// https://manderc.com/apps/umrechner/index_eng.php

const { bitArrayToByte, numberToBitArray } = require('./helpers.js')

function bitToWave(bool) {
  return [
    highWaveFromDuration(563),
    bool ? lowWaveFromDuration(563) : lowWaveFromDuration(1688)
  ]
}

function highWaveFromDuration(duration, wavePulses, ledPin=23, frequency=38400, dutyCycle=0.5) {
  const usDelay = (1/frequency) * Math.pow(10, 6)
  const cycles = Math.round(duration * frequency / Math.pow(10, 6))
  const pulses = []

  for(let index = 0; index < cycles; index++) {
    pulses.push({ gpioOn: ledPin, gpioOff: 0, usDelay: Math.round(usDelay * dutyCycle) })
    pulses.push({ gpioOn: 0, gpioOff: ledPin, usDelay: Math.round(usDelay * (1 - dutyCycle)) })
  }

  // pulses.forEach((pulse) => actualCSV += `${pulse.gpioOn ? 1 : 0},${pulse.usDelay}\n`)

  if (wavePulses) {
    return [...wavePulses, ...pulses]
  } else {
    return pulses
  }
}

function lowWaveFromDuration(duration, wavePulses, ledPin=23) {

  // actualCSV += `0,${duration}\n`

  if (wavePulses) {
    return [...wavePulses, { gpioOn: 0, gpioOff: ledPin, usDelay: duration }]
  } else {
    return [{ gpioOn: 0, gpioOff: ledPin, usDelay: duration }]
  }
}

function necToWave(necAddress, necCommand, extendedNecAddress, extendedNecCommand) {
  // if we aren't provided extended address/command, assume we should make the complement
  // of the address/command
  if (!extendedNecAddress) {
    extendedNecAddress = numberToBitArray(necAddress, 8).map((bit) => !bit)
  } else {
    extendedNecAddress = numberToBitArray(extendedNecAddress, 8)
  }
  if (!extendedNecCommand) {
    extendedNecCommand = numberToBitArray(necCommand, 8).map((bit) => !bit)
  } else {
    extendedNecCommand = numberToBitArray(extendedNecCommand, 8)
  }


    const addressBits = numberToBitArray(necAddress, 8)
    //const extendedAddressBits = numberToBitArray(extendedNecAddress, 8)
    const commandBits = numberToBitArray(necCommand, 8)
    //const extendedCommandBits = numberToBitArray(extendedNecCommand, 8)
    console.log(`Sending NEC command.`)
    console.log(`Address             : ${JSON.stringify(addressBits)} (${bitArrayToByte(addressBits)}, 0x${bitArrayToByte(addressBits).toString(16)})`)
    console.log(`Address (complement): ${JSON.stringify(extendedNecAddress)} (${bitArrayToByte(extendedNecAddress)}, 0x${bitArrayToByte(extendedNecAddress).toString(16)})`)
    console.log(`Command             : ${JSON.stringify(commandBits)} (${bitArrayToByte(commandBits)}, 0x${bitArrayToByte(commandBits).toString(16)})`)
    console.log(`Command (complement): ${JSON.stringify(extendedNecCommand)} (${bitArrayToByte(extendedNecCommand)}, 0x${bitArrayToByte(extendedNecCommand).toString(16)})`)

  // the first two waves are the NEC start header
  // the last wave signals the end of transmission
  let wave = [
    highWaveFromDuration(9000),
    lowWaveFromDuration(4500),
    numberToBitArray(necAddress, 8).map(bitToWave),
    extendedNecAddress.map(bitToWave),
    numberToBitArray(necCommand, 8).map(bitToWave),
    extendedNecCommand.map(bitToWave),
    highWaveFromDuration(563)
  ]

  return wave.flat(Infinity)
}

function bitArrayToWave(bitArray) {
  const wave = []

  for (let i = 0; i < bitArray.length; i++) {
    wave.push(...highWaveFromDuration(563))
    if(bitArray[i]) {
      wave.push({ level: 0, usDelay: 563 })
    } else {
      wave.push({ level: 0, usDelay: 1688 })
    }
  }
}

function is(value, expected, tolerance=.33) {
  const lowTolerance = 1 - tolerance
  const highTolerance = 1 + tolerance

  return value <= expected * highTolerance && value >= expected * lowTolerance
}

function waveToNec(wave, validateAddress = false, validateCommand = true) {

  if (!wave[0] || wave[0].level !== 1 || is(wave[0], 9000))
    throw new Error(`First pulse should be high for 9000 uS.\n\nSegments: ${JSON.stringify(wave, null, 2)}`)

  if (!wave[1] || wave[1].level !== 0 || is(wave[1], 4500))
    throw new Error(`Second pulse should be low for 4500 uS.\n\nSegments: ${JSON.stringify(wave, null, 2)}`)


  wave.forEach((segment, index) => {
    // this device is noncompliant and sends a half-length HIGH to end its repeat code...
    if (index !== 0 && index !== 1 && segment.level === 1 && !is(segment.duration, 563) && !is(segment.duration, 281))
      throw new Error(`Seperator at index ${index} is not the expected size (563); was actually ${segment.duration}.\n\nSegments: ${JSON.stringify(wave, null, 2)}`)
  })

  // wave = wave.slice(2)

  let durations = wave.filter((segment) => segment.level === 0 && !is(segment, 4500)).map((segment) => segment.duration)
  console.log(`wave.length: ${wave.length}`)
  if (wave.length === 1) {
    console.log('This is a repeat code.')
  }

  try {
    const address = readByte(durations, 1)
    const addressComplement = readByte(durations, 1 + 8)
    const command = readByte(durations, 1 + 8*2)
    const commandComplement = readByte(durations, 1 + 8*3)

    console.log(`Received NEC command.`)
    console.log(`Address             : ${JSON.stringify(address)} (${bitArrayToByte(address)}, 0x${bitArrayToByte(address).toString(16)})`)
    console.log(`Address (complement): ${JSON.stringify(addressComplement)} (${bitArrayToByte(addressComplement)}, 0x${bitArrayToByte(addressComplement).toString(16)})`)
    console.log(`Command             : ${JSON.stringify(command)} (${bitArrayToByte(command)}, 0x${bitArrayToByte(command).toString(16)})`)
    console.log(`Command (complement): ${JSON.stringify(commandComplement)} (${bitArrayToByte(commandComplement)}, 0x${bitArrayToByte(commandComplement).toString(16)})`)

    // the device i'm driving appears to have a two byte address! the command complement works fine, but not address
    if (validateAddress) validateComplement(address, addressComplement)
    if (validateCommand) validateComplement(command, commandComplement)

  } catch (e) {
    console.log(`Segments: ${JSON.stringify(wave, null, 2)}`)
    throw e
  }
}

function readBit(duration, highDuration=1688, lowDuration=563) {
  if (is(duration, highDuration)) {
    return 0
  } else if (is(duration, lowDuration)) {
    return 1
  } else {
    throw new Error(`Bit with duration ${duration} is not the expected size (563 or 1688).`)
  }
}

function readByte(array, startIndex=0, highDuration=1688, lowDuration=563) {
  const byte = []
  for (let i = startIndex; i < startIndex + 8; i++) {
    byte.push(readBit(array[i]))
  }

  return byte
}

function validateComplement(a, b) {
  if (a.length !== b.length) throw new Error(`Cannot be complimentary (differing lengths).`)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) throw new Error(`Not complimentary; at index ${i}, both bytes contain the value ${a[i]}.`)
  }
}

module.exports = {
  necToWave,
  waveToNec,
  is,
  highWaveFromDuration,
  lowWaveFromDuration
}
