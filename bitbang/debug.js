const { bitStringToNumber } = require('./index.js')

const remoteMessage = [450, -419, 443, -427, 446, -422, 451, -420, 452, -416, 446, -24978, 3521, -1697, 453, -1286, 449, -419, 453, -418, 445, -424, 448, -1294, 451, -417, 445, -426, 509, -360, 450, -418, 444, -1298, 446, -422, 451, -1288, 447, -1292, 453, -418, 454, -1285, 450, -1290, 445, -1294, 451, -1288, 446, -1296, 449, -419, 454, -417, 445, -1294, 451, -418, 444, -427, 445, -424, 449, -422, 451, -417, 445, -426, 446, -423, 450, -421, 452, -416, 446, -423, 449, -422, 451, -418, 444, -427, 445, -423, 450, -421, 452, -417, 445, -426, 446, -423, 450, -1289, 445, -426, 447, -421, 451, -420, 453, -415, 447, -425, 447, -1292, 453, -415, 447, -425, 448, -420, 453, -1289, 445, -1294, 451, -417, 446, -1295, 450, -420, 452, -416, 446, -426, 447, -421, 451, -420, 453, -415, 447, -424, 448, -421, 452, -419, 453, -415, 447, -1295, 450, -1289, 446, -1293, 452, -1287, 447, -1292, 505, -367, 443, -1295, 450, -419, 454, -417, 445, -423, 450, -421, 451, -445, 417, -427, 446, -422, 450, -421, 452, -417, 445, -426, 446, -423, 449, -422, 451, -417, 445, -426, 447, -422, 450, -421, 452, -417, 445, -423, 450, -422, 451, -417, 444, -427, 446, -422, 451, -420, 452, -417, 445, -427, 446, -422, 451, -420, 452, -417, 445, -426, 447, -421, 452, -420, 452, -416, 446, -424, 449, -420, 452, -419, 454, -414, 448, -424, 449, -419, 453, -418, 444, -425, 448, -423, 450, -418, 454, -417, 445, -424, 448, -423, 450, -418, 454, -417, 445, -423, 450, -422, 450, -1289, 446, -422, 450, -1289, 446, -426, 509, -359, 451, -420, 452, -1287, 448, -1291, 454, -418, 444, -424, 448, -423, 450, -418, 454, -418, 444, -424, 449, -422, 450, -418, 444, -427, 446, -422, 450, -421, 503, -366, 444, -426, 447, -422, 450, -421, 452, -417, 445, -1294, 451, -1288, 447, -424, 448, -420, 453, -419, 453, -1286, 449, -422, 450, -1289, 446]

const piMessage = [470, -449, 434, -459, 435, -457, 436, -456, 437, -455, 438, -24952, 3538, -1725, 435, -1317, 439, -428, 465, -454, 439, -453, 440, -1310, 435, -432, 462, -430, 463, -456, 437, -455, 438, -1312, 444, -449, 434, -1316, 439, -1313, 442, -425, 468, -1309, 436, -1316, 439, -1313, 443, -1282, 462, -1290, 466, -453, 440, -427, 466, -1311, 434, -432, 461, -458, 436, -456, 437, -429, 464, -454, 439, -427, 467, -451, 442, -450, 443, -423, 460, -458, 435, -431, 463, -429, 464, -428, 465, -453, 441, -425, 468, -450, 444, -424, 459, -431, 462, -1315, 440, -426, 467, -426, 467, -425, 469, -423, 460, -432, 461, -1315, 441, -426, 467, -452, 441, -451, 445, -1306, 437, -1314, 441, -426, 467, -1311, 434, -432, 462, -431, 462, -456, 437, -429, 464, -428, 466, -453, 440, -452, 441, -451, 443, -423, 460, -432, 461, -1315, 441, -1311, 444, -1282, 463, -1289, 467, -1285, 470, -423, 471, -1307, 438, -455, 438, -428, 466, -453, 440, -426, 467, -451, 443, -423, 460, -432, 461, -431, 462, -456, 437, -429, 465, -453, 440, -451, 442, -450, 443, -449, 434, -458, 436, -457, 436, -429, 464, -428, 465, -454, 440, -452, 441, -425, 469, -449, 433, -459, 435, -431, 462, -456, 438, -428, 465, -453, 440, -452, 442, -424, 469, -449, 434, -432, 461, -431, 463, -455, 438, -428, 465, -453, 441, -451, 442, -450, 443, -449, 434, -458, 436, -457, 436, -430, 463, -455, 438, -427, 467, -451, 442, -450, 443, -423, 460, -432, 461, -457, 436, -456, 437, -1313, 443, -450, 443, -1308, 437, -430, 464, -454, 439, -454, 439, -1311, 444, -1281, 464, -429, 465, -428, 465, -453, 440, -426, 468, -425, 468, -450, 443, -423, 460, -432, 462, -430, 463, -455, 438, -454, 439, -453, 441, -451, 442, -424, 469, -449, 434, -458, 435, -1315, 441, -1285, 470, -423, 460, -458, 435, -457, 437, -1314, 441, -426, 467, -1309, 436]

function messageToBits(message) {
  message = message.filter((duration) => duration < 0)
    message = message.map((duration) => {
      duration = -duration
      if (duration >= 320 && duration < 500) {
        return 0
      } else if (duration >=1250 && duration < 1400) {
        return 1
      } else {
        return duration
      }
    })
  return message
}

function removeHeader(message) {
  return message.slice(7)
}

function chunk(message) {
  const res = []
  for(i = 0; i < message.length / 8; i++) {
    res.push(message.slice(i*8, (i+1)*8).join(""))
  }
  return res
}

function byteStringToNum(arrayOfByteStrings) {
  return arrayOfByteStrings.map((byte) => Number(bitStringToNumber(byte)).toString(16))
}

console.log('remote mes', chunk(removeHeader(messageToBits(remoteMessage))).join(','))
console.log('pi mes    ', chunk(removeHeader(messageToBits(piMessage))).join(','))

console.log('remote mes', byteStringToNum(chunk(removeHeader(messageToBits(remoteMessage)))).join(', '))
console.log('pi mes    ', byteStringToNum(chunk(removeHeader(messageToBits(piMessage)))).join(', '))

console.log('remote metrics')
metricsFromBucket(bucket(remoteMessage))
console.log('2nd newest metrics')
metricsFromBucket(bucket(piMessage))

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
