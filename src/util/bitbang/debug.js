const { bitStringToNumber } = require('./helpers.js')

const remoteMessage = [450, -418, 444, -427, 446, -422, 450, -422, 450, -418, 506, -24917, 3516, -1701, 449, -1291, 443, -425, 448, -423, 449, -419, 454, -1288, 446, -423, 449, -422, 451, -418, 444, -424, 500, -1242, 450, -418, 444, -1295, 450, -1289, 445, -426, 447, -1292, 453, -1287, 447, -1292, 453, -1286, 448, -1294, 451, -417, 507, -365, 445, -1293, 452, -416, 445, -427, 446, -422, 450, -421, 451, -417, 445, -427, 445, -423, 450, -421, 451, -417, 445, -424, 448, -423, 450, -418, 454, -418, 444, -424, 449, -422, 450, -418, 454, -418, 444, -424, 449, -1290, 454, -417, 445, -424, 449, -422, 450, -418, 454, -417, 445, -1294, 451, -418, 454, -417, 445, -423, 501, -1242, 451, -1287, 447, -421, 451, -1288, 446, -425, 447, -422, 451, -420, 452, -416, 446, -425, 447, -422, 451, -420, 452, -416, 446, -426, 446, -421, 452, -420, 452, -416, 446, -425, 447, -421, 451, -420, 453, -1286, 448, -424, 449, -1290, 444, -424, 448, -423, 450, -419, 453, -418, 444, -424, 448, -423, 450, -419, 453, -416, 508, -363, 499, -369, 451, -420, 453, -415, 447, -424, 448, -421, 451, -420, 453, -416, 446, -425, 447, -421, 451, -420, 452, -416, 446, -425, 510, -359, 503, -369, 451, -416, 508, -281, 581, -342, 479, -419, 453, -415, 447, -424, 448, -421, 451, -420, 453, -415, 446, -426, 447, -421, 451, -420, 453, -415, 446, -426, 447, -421, 451, -420, 453, -416, 446, -425, 447, -422, 451, -420, 452, -416, 446, -425, 447, -421, 451, -421, 452, -416, 446, -1293, 451, -420, 453, -1285, 449, -422, 450, -419, 454, -417, 445, -1294, 452, -1287, 445, -423, 449, -1290, 444, -1298, 447, -421, 451, -420, 453, -416, 446, -425, 447, -422, 450, -418, 444, -427, 446, -423, 449, -422, 450, -418, 444, -427, 445, -423, 450, -422, 450, -418, 454, -1285, 450, -421, 451, -1288, 446, -425, 447, -1292, 453, -1287, 447, -1292, 453]

const piMessage = [460, -431, 462, -430, 463, -429, 464, -428, 465, -427, 466, -24952, 3534, -1702, 469, -1284, 461, -431, 462, -430, 463, -429, 464, -1287, 468, -424, 469, -423, 470, -422, 460, -432, 462, -1290, 464, -428, 466, -1286, 469, -1283, 462, -430, 463, -1289, 466, -1286, 469, -1283, 462, -1290, 466, -1287, 468, -424, 469, -423, 460, -1292, 463, -429, 465, -427, 466, -426, 467, -425, 468, -424, 469, -423, 460, -432, 461, -431, 462, -430, 464, -428, 465, -427, 466, -426, 467, -425, 469, -423, 470, -422, 461, -431, 462, -430, 463, -429, 464, -1288, 467, -425, 468, -424, 470, -422, 460, -432, 461, -431, 462, -1289, 466, -426, 467, -425, 468, -424, 469, -1283, 462, -1290, 465, -427, 467, -1285, 470, -422, 461, -431, 462, -430, 463, -429, 464, -428, 466, -426, 467, -425, 468, -424, 469, -424, 469, -423, 460, -432, 461, -431, 462, -430, 464, -427, 466, -426, 467, -1285, 470, -422, 461, -1291, 464, -428, 465, -428, 465, -426, 467, -425, 468, -425, 469, -423, 460, -432, 461, -431, 462, -430, 463, -429, 464, -428, 465, -427, 467, -425, 468, -424, 469, -423, 460, -432, 462, -430, 463, -429, 464, -428, 465, -427, 467, -425, 468, -424, 469, -423, 470, -422, 461, -432, 461, -430, 463, -429, 465, -428, 465, -427, 466, -425, 468, -425, 468, -423, 470, -423, 460, -432, 461, -431, 462, -430, 464, -428, 465, -426, 467, -425, 468, -424, 469, -423, 470, -422, 460, -432, 462, -430, 463, -429, 464, -428, 465, -427, 466, -426, 467, -1285, 460, -432, 462, -1290, 465, -427, 466, -426, 467, -425, 468, -1284, 471, -1281, 464, -428, 465, -1287, 469, -1283, 461, -431, 462, -430, 463, -429, 465, -427, 466, -426, 467, -425, 468, -424, 469, -423, 470, -422, 461, -431, 462, -430, 464, -429, 464, -428, 465, -427, 467, -1285, 470, -422, 461, -1291, 464, -428, 465, -1287, 469, -1283, 461, -1291, 464]

function messageToBits(message, zeroLowerBound, zeroUpperBound, oneLowerBound, oneUpperBound, activeLow=true) {
  message = message.filter((duration) => activeLow ? duration < 0 : duration > 0)
  message = message.map((duration, index) => {
    if (activeLow) duration = -duration

    // TODO: Validate that bounds don't overlap

    if (duration >= zeroLowerBound && duration < zeroUpperBound) {
      return 0
    } else if (duration >=oneLowerBound && duration < oneUpperBound) {
      return 1
    } else {
      console.log('ERROR', duration, 'at index', index)
      // return duration
      return 2
    }
  })

  return message
}

function removeHeader(message, length) {
  return message.slice(length)
}

function chunk(message) {
  const res = []
  for(i = 0; i < message.length / 8; i++) {
    res.push(message.slice(i*8, (i+1)*8).join(""))
  }
  return res
}

function byteStringToNum(arrayOfByteStrings) {
  return arrayOfByteStrings.map((byte) => Number(bitStringToNumber(byte)).toString(16).padStart(2, ' '))
}

/*
console.log('           | header                          | Msg Id |  Mode  | Temper | Fixed  |  Fan   | Fixed  | Timers                   | Powerf | Fixed           | EcoCom | Fixed  | Checksum')

console.log('remote mes |', byteStringToNum(chunk(removeHeader(messageToBits(remoteMessage)))).join('   |   '))
console.log('pi mes     |', byteStringToNum(chunk(removeHeader(messageToBits(piMessage)))).join('   |   '))

console.log('remote mes', chunk(removeHeader(messageToBits(remoteMessage))).join(','))
console.log('pi mes    ', chunk(removeHeader(messageToBits(piMessage))).join(','))

console.log('remote metrics')
metricsFromBucket(bucket(remoteMessage))
console.log('2nd newest metrics')
metricsFromBucket(bucket(piMessage))
*/

function bucket(message) {
  const shortLow = []
  const longLow = []
  const separator = []
  const other = []
  message = message.forEach((duration) => {
    if (duration > 0) {
      separator.push(duration)
    } else {
      duration = -duration
      if (duration >= 320 && duration < 500) {
        shortLow.push(duration)
      } else if (duration >=1250 && duration < 1400) {
        longLow.push(duration)
      } else {
        other.push(duration)
      }
    }
  })
  return { shortLow, longLow, separator, other }
}

function metricsFromBucket(bucket) {
  console.log('Min short:', bucket.shortLow.sort()[0])
  console.log('Avg short:', bucket.shortLow.reduce((a, b) => a + b, 0) / bucket.shortLow.length)
  console.log('Max short:', bucket.shortLow.sort().pop())
  console.log('Min long: ', bucket.longLow.sort()[0])
  console.log('Avg long: ', bucket.longLow.reduce((a, b) => a + b, 0) / bucket.longLow.length)
  console.log('Max long: ', bucket.longLow.sort().pop())
  console.log('Min separ: ', bucket.separator.sort()[0])
  console.log('Avg separ: ', bucket.separator.reduce((a, b) => a + b, 0) / bucket.separator.length)
  console.log('Max separ: ', bucket.separator.sort().pop())
}

module.exports = exports = {
  byteStringToNum,
  chunk,
  removeHeader,
  messageToBits,
  remoteMessage
}
