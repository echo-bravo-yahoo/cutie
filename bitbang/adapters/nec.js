// https://exploreembedded.com/wiki/NEC_IR_Remote_Control_Interface_with_8051
// https://manderc.com/apps/umrechner/index_eng.php

const { bitArrayToByte, bitToWave, highWaveFromDuration, lowWaveFromDuration, numberToBitArray, is, readByte } = require('../helpers.js')
const { checkWave } = require('../pulse.js')

const readNECByte = (array, startIndex) => readByte(array, startIndex, false, 1688, 563)

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

  let durations = wave.filter((segment) => segment.level === 0 && !is(segment, 4500)).map((segment) => segment.duration)
  console.log(`wave.length: ${wave.length}`)
  if (wave.length === 1) {
    console.log('This is a repeat code.')
  }

  try {
    const address = readNECByte(durations, 1)
    const addressComplement = readNECByte(durations, 1 + 8)
    const command = readNECByte(durations, 1 + 8*2)
    const commandComplement = readNECByte(durations, 1 + 8*3)

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

async function transmitNECCommand(pigpio, address, command, extendedAddress, extendedCommand) {
  pigpio.waveClear()

  return new Promise((resolve, reject) => {
    pigpio.waveAddGeneric(necToWave(address, command, extendedAddress, extendedCommand))
    const waveId = pigpio.waveCreate()
    // TODO: figure out why WAVE_MODE_ONE_SHOT_SYNC binds things up - it would be really helpful...
    pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT)
    checkWave(pigpio, resolve.bind(null, waveId))
  })
}

let lastTick
let pulse = []
const maxGap = 15000 // in uS; needs to be longer than the 9000 uS of the NEC start block
let timeoutHandle


function necListener(level, tick, pigpio) {
  if (lastTick === undefined) lastTick = pigpio.getTick()

  if (pigpio.waveTxBusy()) {
    console.log('Seeing our own transmit...')
    return
  }

  const duration = pigpio.tickDiff(lastTick, tick) // in uS
  lastTick = tick

  if (pulse.length === 0 && level === 1 && is(duration, 9000)) {
    // starting a new NEC instruction
    console.log(`New command starting!`)
    pulse = [{ level, duration }]
  } else if (pulse.length === 67) {
    console.log(`Received a full NEC command.`)
    waveToNec(pulse)
    pulse = []
  } else if (pulse.length) {
    pulse.push({ level, duration })
  }

  if (timeoutHandle) clearTimeout(timeoutHandle)

  setTimeout(() => {
    const difference = pigpio.tickDiff(lastTick, pigpio.getTick())
    if (pulse.length === 67) {
      console.log(`Received a full NEC command.`)
      waveToNec(pulse)
    } else if (pulse.length && difference >= maxGap) {
      console.log(`Received an invalid NEC command with ${pulse.length} pulses. Starting over...`)
      pulse = []
    }
    // why do we need this to be _ten times_ too long to work? not a single clue!
  }, maxGap/1000*10) // convert to uS
}

module.exports = {
  necToWave,
  waveToNec,
  is,
  highWaveFromDuration,
  lowWaveFromDuration,
  transmitNECCommand,
  necListener
}
