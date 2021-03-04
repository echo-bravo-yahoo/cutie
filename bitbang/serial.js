const SerialPort = require('serialport')
const serial = new SerialPort('/dev/ttyS5')
const Readline = require('@serialport/parser-readline')
const { byteStringToNum, chunk, removeHeader, messageToBits, remoteMessage } = require('./debug')

function lineToNumArray(line) {
  let array = line.split(' ').slice(4).join('')
  array = array.split(',')

  // there's a trailing empty string, get rid of it
  array.pop()

  return array.map((stringified) => parseInt(stringified, 10))
}

const parser = serial.pipe(new Readline({ delimiter: '\r\n' }))
parser.on('data', (line) => {
  if (line.includes('Raw')) {
    let array = lineToNumArray(line)

    // this is specific to the AC message
    // console.log(byteStringToNum(chunk(removeHeader(messageToBits(array, 275, 500, 1200, 1400), 7))).join(' '))


    // this is specific to the vaccuum remote
    array = array.filter((number) => Math.abs(number) < 2800)
    console.log(byteStringToNum(chunk(removeHeader(messageToBits(array, 400, 525, 1200, 1500), 2))).join(' '))

  } else {
    console.log(line)
  }
})
