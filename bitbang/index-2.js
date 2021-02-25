const io = require('rpio')

// it takes FOREVER to turn the LED on and off for the first time, so let's do that as part of setup
io.open(16, io.OUTPUT)
// io.write(16, io.HIGH)
// io.write(16, io.LOW)
// io.usleep(10000)

io.pdeSetSeparator(16, io.HIGH)
// numbers from https://github.com/blafois/Daikin-IR-Reverse
// average of high and low values
io.pdeSetShortDuration(16, 417)
io.pdeSetLongDuration(16, 1282)
io.pdeSetSeparatorDuration(16, 462)

io.pdeWrite(16, Buffer.from([
  0x11, 0xda, 0x27, 0x00, 0x00, 0x49, 0x2C, 0x00, 0x5F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x66
]))

console.log('DONE')

// "build a message from scratch"
// |   header    | Msg Id | Mode | Temp | Fixed | Fan | Fixed |  Timers  | Pwrful | Fixed | Econo | Fixed | Checksum |
// | 11 da 27 00 |   00   |  xx  |  xx  |   00  |  xx |   00  | xx xx xx |   0x   |   00  |   8x  |   00  |    xx    |
// "heat" at 72F, 3/5 fan speed, swing enabled
// | 11 da 27 00 |   00   |  49  |  2C  |   00  |  5F |   00  | 00 00 00 |   00   |   00  |   80  |   00  |    66    |

// manual: https://www.daikinac.com/content/assets/DOC/OperationManuals/01-EN-3P379751-4C.pdf
// comfort mode: blows up for cool, down for heat 'avoid blowing on you'
// econo: lower power use
// powerful: 20 minutes of max (AC, heat), then return to previous settings
  // mai
