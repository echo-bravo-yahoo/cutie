const { writeFileSync } = require('fs')
const { resolve } = require('path')

let generatedCSV = ''
function writeGeneratedCSV() {
  writeFileSync(resolve(__dirname, './generated.csv'), generatedCSV)
}

function bitArrayToByte(bitArray, lsbFirst=true) {
  // if (bitArray.length !== 8) throw new Error(`Bit array is ${bitArray.length} bits long, but it should be 8 bits long to convert to a byte!`)
  if (bitArray.length !== 8) console.log(`Bit array is ${bitArray.length} bits long, but it should be 8 bits long to convert to a byte!`)
  let result = 0x00
  for(let i = 0; i < 8; i++) {
    if (lsbFirst) {
    result = result | Math.pow(2, i) * bitArray[i]
    } else {
    result = result | Math.pow(2, i) * bitArray[7 - i]
    }
  }

  return result
}

function graphToTerminal(wave, buckets) {
  const width = process.stdout.columns
  let widthConsumed = 6
  let markers = ['      ']
  let highGraphLines = ['HIGH: ']
  let lowGraphLines = ['LOW : ']
  let currentLine = 0

  for (let i = 0; i < wave.length; i++) {
    if (width - widthConsumed === 0) {
      markers.push('      ')
      highGraphLines.push('HIGH: ')
      lowGraphLines.push('LOW : ')
      widthConsumed = 6
      currentLine++
    }

    let fit = []
    for (let j = 0; j < buckets.length; j++) {
      const bucket = buckets[j]
      if (is(wave[i].duration, bucket.duration, bucket.tolerance)) {
        fit.push(bucket)
        if (i % 5 === 0) {
          const marker = `↙${i}`
          if (width - widthConsumed - marker.length >= 0)
            markers[currentLine] += marker
        } else {
          if (markers[currentLine].length === highGraphLines[currentLine].length)
            markers[currentLine] += ' '
        }

        if (wave[i].level) {
          highGraphLines[currentLine] += (bucket.indicator ? bucket.indicator : j)
          lowGraphLines[currentLine] += (' ')
          widthConsumed++
        } else {
          lowGraphLines[currentLine] += (bucket.indicator ? bucket.indicator : j)
          highGraphLines[currentLine] += (' ')
          widthConsumed++
        }
      }

      if (fit.length > 1) throw new Error(`Pulse at index ${i} with duration ${wave[i].duration} fit multiple buckets!\n${JSON.stringify(fit)}`)
    }

  }

  const lines = highGraphLines.reduce((str, next, index) => {
    return `${str}\n${markers[index]}\n${next}\n${lowGraphLines[index]}\n\n`
  }, '')

  return lines
}

function numberToBitString(number, width) {
  return arrayToBitString(numberToBitArray(number, width))
}

function numberToBitArray(number, width, lsbFirst=true) {
  let bitArray = []
  for(let i = 0; i < (width || 32); i++) {
    const bit = (Math.pow(2, i) & number) ? true : false
    bitArray.push(bit)
  }

  return lsbFirst ? bitArray : bitArray.reverse()
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

function is(value, expected, tolerance=.33) {
  const lowTolerance = 1 - tolerance
  const highTolerance = 1 + tolerance

  return value <= expected * highTolerance && value >= expected * lowTolerance
}

function highWaveFromDuration(duration, wavePulses, ledPin=23, frequency=38400, dutyCycle=0.5) {
  const usDelay = (1/frequency) * Math.pow(10, 6)
  const cycles = Math.round(duration * frequency / Math.pow(10, 6))
  const pulses = []

  for(let index = 0; index < cycles; index++) {
    pulses.push({ gpioOn: ledPin, gpioOff: 0, usDelay: Math.round(usDelay * dutyCycle) })
    pulses.push({ gpioOn: 0, gpioOff: ledPin, usDelay: Math.round(usDelay * (1 - dutyCycle)) })
  }

  pulses.forEach((pulse) => generatedCSV += `${pulse.gpioOn ? 1 : 0},${pulse.usDelay}\n`)

  if (wavePulses) {
    return [...wavePulses, ...pulses]
  } else {
    return pulses
  }
}

function simpleWaveFromDuration(level, duration) {
  return [{ level, duration }]
}

function lowWaveFromDuration(duration, wavePulses, ledPin=23) {

  generatedCSV += `0,${duration}\n`

  if (wavePulses) {
    return [...wavePulses, { gpioOn: 0, gpioOff: ledPin, usDelay: duration }]
  } else {
    return [{ gpioOn: 0, gpioOff: ledPin, usDelay: duration }]
  }
}

function bitArrayToWave(bitArray, ledPin=23) {
  const wave = []

  for (let i = 0; i < bitArray.length; i++) {
    wave.push(...highWaveFromDuration(563))
    if(bitArray[i]) {
      wave.push({ gpioOn: 0, gpioOff: ledPin, usDelay: 563 })
    } else {
      wave.push({ gpioOn: 0, gpioOff: ledPin, usDelay: 1688 })
    }
  }

  return wave
}

function validateComplement(a, b) {
  if (a.length !== b.length) throw new Error(`Cannot be complimentary (differing lengths).`)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) throw new Error(`Not complimentary; at index ${i}, both bytes contain the value ${a[i]}.`)
  }
}

function readBit(duration, highDuration=1688, lowDuration=563) {
  if (is(duration, highDuration)) {
    return 0
  } else if (is(duration, lowDuration)) {
    return 1
  } else {
    console.error(`Bit with duration ${duration} is not the expected size (${lowDuration} or ${highDuration}).`)
    return duration < lowDuration ? 1 : 0
    // throw new Error(`Bit with duration ${duration} is not the expected size (${lowDuration} or ${highDuration}).`)
  }
}

function readByte(array, startIndex=0, littleEndian=true, highDuration=1688, lowDuration=563) {
  const byte = []
  let i

  try {
    for (i = startIndex; i < startIndex + 8; i++) {
      if (array[i] === undefined) {
        byte.push(0)
      } else {
        byte.push(readBit(array[i], highDuration, lowDuration))
      }
    }
  } catch (error) {
    if (error.message.includes('Bit with duration'))
      error.message = error.message.replace(/^Bit with duration/, `Bit at index ${i} with duration`)
    throw error
  }

  return littleEndian ? byte.reverse() : byte
}

function clamp(value, min, max) {
  return Math.min(Math.max(min, value), max)
}

module.exports = {
  arrayToNumber,
  arrayToBitString,
  bitArrayToByte,
  bitArrayToWave,
  bitStringToArray,
  bitStringToNumber,
  clamp,
  graphToTerminal,
  highWaveFromDuration,
  is,
  lowWaveFromDuration,
  numberToBitArray,
  numberToBitString,
  readBit,
  readByte,
  simpleWaveFromDuration,
  validateComplement,
  writeGeneratedCSV
}
