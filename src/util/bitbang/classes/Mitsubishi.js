const { ByteArray } = require('./ByteArray.js')
const { Byte } = require('./Byte.js')
const { BitArray } = require('./BitArray.js')
const { clamp, lowWaveFromDuration, highWaveFromDuration } = require('../helpers.js')
const { checkWave } = require('../../bitbang/pulse.js')

// DISCREPENCIES
// fanSpeed 5 is ??? a whirligig
// fanSpeed 6 is silent
// vane setting after swing is ??? a whirligig
// econoCool sends a different footer and crashes the listener
// first MODE (four pointy arrows?) sends differing firstmode and secondmode bytes and crashes the listener
// have not tried time, stop, start yet

// info largely from: https://www.analysir.com/blog/2015/01/06/reverse-engineering-mitsubishi-ac-infrared-protocol
class Mitsubishi {
  minTemp = 16
  maxTemp = 31
  minTempF = this.celsiusIntToFahrenheitInt(this.minTemp)
  maxTempF = this.celsiusIntToFahrenheitInt(this.maxTemp)

  commandToBytes(command) {
    // start with the static header
    const bytes = new ByteArray([0x23, 0xCB, 0x26, 0x01, 0x00], false)

    // on or off
    bytes.push(new Byte(command.on ? 0x20 : 0x0))

    if (command.mode === 'HEAT')
      bytes.push(new BitArray([0, 0, 0, 0, 1, 0, 0, 0]))
    if (command.mode === 'DRY')
      bytes.push(new BitArray([0, 0, 0, 1, 0, 0, 0, 0]))
    if (command.mode === 'COLD')
      bytes.push(new BitArray([0, 0, 0, 1, 1, 0, 0, 0]))
    if (command.mode === 'AUTO')
      bytes.push(new BitArray([0, 0, 1, 0, 0, 0, 0, 0]))


    // if the requested value is in the range 16 < t < 31, it's in centigrade
    if (command.temperature === clamp(command.temperature, this.minTemp, this.maxTemp)) {
      // 16' C is represented by 0x0
      // but we add 32 for half-step degrees
      if (command.temperature === (Math.floor(command.temperature) + .5)) {
        bytes.push(new Byte(Math.floor(command.temperature)))
      } else {
        bytes.push(new Byte(command.temperature - 16))
      }
    } else if (command.temperature === clamp(command.temperature, this.minTempF, this.maxTempF)) { // otherwise, it's fahrenheit
      const celsius = this.celsiusIntToFahrenheitInt(command.temperature)
      if (celsius !== clamp(celsius, this.minTemp, this.maxTemp) && celsius !== clamp(celsius, 32, 47))
        console.error(`Temperature ${command.temperature} is out of bounds for either a Celsius temperature (${this.minTemp} - ${this.maxTemp}) or a Fahrenheit temperature (${this.minTempF} - ${this.maxTempF}).`)
        // throw new Error(`Temperature ${command.temperature} is out of bounds for either a Celsius temperature (${this.minTemp} - ${this.maxTemp}) or a Fahrenheit temperature (${this.celsiusIntToFahrenheitInt(this.minTemp)} - ${this.celsiusIntToFahrenheitInt(this.maxTemp)}).`)

      // 16' C is represented by 0x0
      // but we add 32 for half-step degrees
      if (command.temperature % 2 === 0) {
        bytes.push(new Byte(celsius))
      } else {
        bytes.push(new Byte(celsius - 16))
      }
    }

    // how does it tell HEAT from AUTO?? does it have to look back at the prior block??
    if (command.mode === 'HEAT')
      bytes.push(new BitArray([0, 0, 1, 1, 0, 0, 0, 0]))
    if (command.mode === 'DRY')
      bytes.push(new BitArray([0, 0, 1, 1, 0, 0, 1, 0]))
    if (command.mode === 'COLD')
      bytes.push(new BitArray([0, 0, 1, 1, 0, 1, 1, 0]))
    if (command.mode === 'AUTO')
      bytes.push(new BitArray([0, 0, 1, 1, 0, 0, 0, 0]))

    const fanByte = new BitArray([0, 0, 0, 0, 0, 0, 0, 0])
    // 1-8 speeds?
    // this library only has fan speeds 1, 2, and 3
    //  https://github.com/r45635/HVAC-IR-Control/blob/master/python/hvac_ircontrol/mitsubishi.py#L79
    //  but these reverse engineereddocs list fan speeds 1-8 (0-7)
    //  https://www.analysir.com/blog/wp-content/uploads/2014/12/Mitsubishi_AC_IR_Signal_Fields.jpg?x48243
    //  which is it?
    if (command.fanSpeed === 'auto') {
      fanByte.overwrite(0, new BitArray([1], 1))
      fanByte.overwrite(5, new BitArray([0, 0, 0], 3))
    } else {
      fanByte.overwrite(5, new BitArray(clamp(command.fanSpeed, 0, 7), 3))
    }

    if (command.vane) {
      const angles = {
        AUTO: [0, 1, 0, 0, 0],
        TOP: [0, 1, 0, 0, 1],
        MIDTOP: [0, 1, 0, 1, 0],
        MIDDLE: [0, 1, 0, 1, 1],
        MIDBOT: [0, 1, 1, 0, 0],
        BOTTOM: [0, 1, 1, 0, 1],
        SWING: [0, 1, 1, 1, 1]
      }
      fanByte.overwrite(0, angles[command.vane], 5)
    }
    bytes.push(fanByte)

    // clock
    bytes.push(new Byte(command.clockByte))

    // end time
    bytes.push(new Byte(0x00))

    // start time
    bytes.push(new Byte(0x00))

    // timer
    bytes.push(new Byte(0x00))

    // static ending signature
    bytes.push([
      new Byte(0x00),
      new Byte(0x00),
      new Byte(0x00)
    ])

    // checksum
    bytes.push(new Byte(bytes.checksum()))

    return bytes
  }

  bytesToCommand(byteArray) {
    if (!(byteArray instanceof ByteArray))
      byteArray = new ByteArray(byteArray)

    const command = {}

    const header = new ByteArray([0x23, 0xCB, 0x26, 0x01, 0x00])
    if (!header.equals(byteArray.slice(0, 5)))
      throw new Error(`Incorrect header for command. Was ${byteArray.slice(0, 5).toString('hex', 'logical')}, should have been: ${header.toString('hex', 'logical')}.`)

    const onByte = byteArray.get(5)
    if (onByte.toNumber() === 0x20) {
      command.on = true
    } else if (onByte.toNumber() === 0) {
      command.on = false
    } else {
      throw new Error(`Unrecognized mode ${onByte.toString('all')}. Should be either on (${new Byte(0x20).toString('all')}) or off (${new Byte(0x0).toString('all')}).`)
    }

    const modeByte = byteArray.get(6)
    if (modeByte.equals(new BitArray([0, 0, 0, 0, 1, 0, 0, 0])))
      command.mode = 'HEAT'
    if (modeByte.equals(new BitArray([0, 0, 0, 1, 0, 0, 0, 0])))
      command.mode = 'DRY'
    if (modeByte.equals(new BitArray([0, 0, 0, 1, 1, 0, 0, 0])))
      command.mode = 'COLD'
    if (modeByte.equals(new BitArray([0, 0, 1, 0, 0, 0, 0, 0])))
      command.mode = 'AUTO'

    const temperatureByte = byteArray.get(7)
    if (temperatureByte.toNumber() > 15) {
      // half step degrees (C, whole step F) are indicated by adding 16 to them...
      command.temperature = temperatureByte.toNumber() + .5
    } else {
      command.temperature = temperatureByte.toNumber() + 16
    }

    const secondModeByte = byteArray.get(8)
    let secondMode
    if (secondModeByte.equals(new BitArray([0, 0, 1, 1, 0, 0, 0, 0])))
      secondMode = 'HEAT'
    if (secondModeByte.equals(new BitArray([0, 0, 1, 1, 0, 0, 1, 0])))
      secondMode = 'DRY'
    if (secondModeByte.equals(new BitArray([0, 0, 1, 1, 0, 1, 1, 0])))
      secondMode = 'COLD'

    // TODO: why is this the same bit sequence as 'HEAT'???
    // if (secondModeByte.equals(new BitArray([0, 0, 1, 1, 0, 0, 0, 0])))
      // secondMode = 'AUTO'
    if (secondMode !== command.mode)
      throw new Error(`First mode byte (${modeByte.toString('all')}) indicated a mode of ${command.mode}, but second mode byte (${secondModeByte.toString('all')}) indicated a mode of ${secondMode}. These bytes must agree on the AC mode.`)

    const fanByte = byteArray.get(9)
    if (fanByte.getBit(0)) {
      command.fanSpeed = 'auto'
      if (fanByte.slice(5, 8).toNumber() !== 0)
        throw new Error(`fanSpeed set to auto, but speed specified as ${fanByte.slice(5, 8).toString('bit', 'logical')}. If fanSpeed is set to auto, speed bits must not be specified.`)
    }
    if (fanByte.slice(5, 8).toNumber()) {
      command.fanSpeed = fanByte.slice(5, 8).toNumber()
    }

    const vaneBits = fanByte.slice(1, 5)
    if (vaneBits.equals([1, 0, 0, 0])) {
      command.vane = 'AUTO'
    } else if (vaneBits.equals([1, 1, 1, 1])) {
      command.vane = 'SWING'
    } else if (vaneBits.equals([1, 0, 0, 1])) {
      command.vane = 'TOP'
    } else if (vaneBits.equals([1, 0, 1, 0])) {
      command.vane = 'MIDTOP'
    } else if (vaneBits.equals([1, 0, 1, 1])) {
      command.vane = 'MIDDLE'
    } else if (vaneBits.equals([1, 1, 0, 0])) {
      command.vane = 'MIDBOT'
    } else if (vaneBits.equals([1, 1, 0, 1])) {
      command.vane = 'BOTTOM'
    }

    const clockByte = byteArray.get(10)
    command.clockByte = clockByte.toString('hex')

    const endTimeByte = byteArray.get(11)
    command.endTime = endTimeByte.toString('hex')

    const startTimeByte = byteArray.get(12)
    command.startTime = startTimeByte.toString('hex')

    const timerByte = byteArray.get(13)
    command.timer = timerByte.toString('hex')

    const expectedFooter = new ByteArray([0x0, 0x0, 0x0])
    const actualFooter = byteArray.slice(14, 17)
    if (!expectedFooter.equals(actualFooter))
      throw new Error(`Incorrect footer for command. Was ${actualFooter.toString('hex', 'logical')}, should have been: ${expectedFooter.toString('hex', 'logical')}.`)

    const expectedChecksum = byteArray.slice(0, -1).checksum()
    const actualChecksum = byteArray.get(17)
    if (actualChecksum.toNumber() !== expectedChecksum)
      console.error(`Incorrect checksum for command. Was ${new Byte(actualChecksum).toString('all')}, should have been: ${new Byte(expectedChecksum).toString('all')}.`)
      // throw new Error(`Incorrect checksum for command. Was ${new Byte(actualChecksum).toString('all')}, should have been: ${new Byte(expectedChecksum).toString('all')}.`)

    return command
  }

  async transmitCommand(command, pigpio) {
    console.log(`Sending command ${JSON.stringify(command)}`)
    const bytes = this.commandToBytes(command)
    console.log(`Bytes: ${bytes.toString('hex')}`)
    const wave = this.byteArrayToWave(bytes)
    pigpio.waveClear()
    pigpio.waveAddGeneric(wave)
    const waveId = pigpio.waveCreate()
    const start = performance.now()
    pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT)
    await checkWave(pigpio)
    const end = performance.now()
    console.log(`Transmission took ${(end - start) * Math.pow(10, 3)} uS`)
  }

  byteArrayToWave(byteArray) {
    let low = lowWaveFromDuration
    let high = highWaveFromDuration
    byteArray.lsbFirst = true
    const bits = byteArray.toBitArray('physical')

    // the first two waves are the Mitsubishi start header
    // the last wave signals the end of transmission
    let wave = [
      high(3500),
      low(1750)
    ]

    // we'll need new headers at bit 291
    for (let i = 0; i < 144; i++) {
      wave.push(high(450))
      wave.push(low(bits[i] ? 1275 : 450 ))
    }

    wave.push(high(450))
    wave.push(low(17000))
    wave.push(high(3500))
    wave.push(low(1750))

    for (let i = 144; i < bits.length; i++) {
      wave.push(high(450))
      wave.push(low(bits[i] ? 1275 : 450 ))
    }

    wave.push(high(450))

    return wave.flat(Infinity)
  }

  mitsubishiListener() {
    // TODO: IMPLEMENT
  }

  celsiusIntToFahrenheitInt(celsius) {
    return Math.round((Math.round(celsius) * (9/5)) + 32)
  }
}

module.exports = {
  Mitsubishi
}

/*
const cmd = {
  "on": true,
  "mode": "HEAT",
  "temperature": 21,
  "fanSpeed": 5,
  "vane": "AUTO",
  "clockByte": "0x54",
  "endTime": "0x0",
  "startTime": "0x0",
  "timer": "0x0"
}

const m = new Mitsubishi()
m.byteArrayToWave(m.commandToBytes(cmd))

const m = new Mitsubishi()
const command = [
  0x23, 0xcb, 0x26,
  0x1,  0x0,  0x20,
  0x8,  0x5,  0x30,
  0x45, 0x54, 0x0,
  0x0,  0x0,  0x0,
  0x0,  0x0,  0xb
]
console.log(`Starting with this hard-coded, byte-wise command:`)
console.log(command.map((byte) => '0x' + byte.toString(16)))

const jsonCommand = m.bytesToCommand(command)
console.log(`Converted to JSON command:`)
console.log(jsonCommand)

const bytewiseCommand = m.commandToBytes(jsonCommand)
console.log(`Converted back to byte-wise command:`)
console.log(bytewiseCommand.logical.map((byte) => byte.toString('hex')))

const finalJsonCommand = m.bytesToCommand(bytewiseCommand)
console.log(`Converted back to JSON:`)
console.log(finalJsonCommand)

const cmd = {
  "on": true,
  "mode": "HEAT",
  "temperature": 21,
  "fanSpeed": 5,
  "vane": "AUTO",
  "clockByte": "0x54",
  "endTime": "0x0",
  "startTime": "0x0",
  "timer": "0x0"
}
*/
