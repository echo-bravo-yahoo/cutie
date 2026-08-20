// Waveform helpers for bit-banging an infrared carrier through pigpio.
// Ported from the vendored CommonJS "bitbang" sub-package; only the pieces the
// NEC transmit path reaches came across. The receive-side decoders and the
// terminal graphing helper were left behind in git history.

// One entry of a pigpio generic waveform: which pins to drive high, which to
// drive low, and how long to hold that state, in microseconds.
export interface Pulse {
  gpioOn: number;
  gpioOff: number;
  usDelay: number;
}

const CARRIER_FREQUENCY_HZ = 38400;
const CARRIER_DUTY_CYCLE = 0.5;
const US_PER_SECOND = 1000000;

// NEC holds the carrier for a fixed period and encodes the bit in the length
// of the gap that follows.
export const NEC_PULSE_US = 563;
export const NEC_LONG_GAP_US = 1688;

export function is(value: number, expected: number, tolerance = 0.33): boolean {
  return (
    value <= expected * (1 + tolerance) && value >= expected * (1 - tolerance)
  );
}

export function numberToBitArray(
  value: number,
  width = 32,
  lsbFirst = true,
): Array<boolean> {
  const bits: Array<boolean> = [];
  for (let i = 0; i < width; i++) bits.push(!!(Math.pow(2, i) & value));

  return lsbFirst ? bits : bits.reverse();
}

export function bitArrayToByte(
  bitArray: Array<boolean>,
  lsbFirst = true,
): number {
  let result = 0x00;
  for (let i = 0; i < 8; i++) {
    const bit = lsbFirst ? bitArray[i] : bitArray[7 - i];
    result = result | (Math.pow(2, i) * Number(bit));
  }

  return result;
}

// A high period is the carrier itself: the LED toggled at the carrier
// frequency for the requested duration.
export function highWaveFromDuration(
  duration: number,
  ledPin: number,
): Array<Pulse> {
  const usDelay = US_PER_SECOND / CARRIER_FREQUENCY_HZ;
  const cycles = Math.round((duration * CARRIER_FREQUENCY_HZ) / US_PER_SECOND);
  const pulses: Array<Pulse> = [];

  for (let i = 0; i < cycles; i++) {
    pulses.push({
      gpioOn: ledPin,
      gpioOff: 0,
      usDelay: Math.round(usDelay * CARRIER_DUTY_CYCLE),
    });
    pulses.push({
      gpioOn: 0,
      gpioOff: ledPin,
      usDelay: Math.round(usDelay * (1 - CARRIER_DUTY_CYCLE)),
    });
  }

  return pulses;
}

export function lowWaveFromDuration(
  duration: number,
  ledPin: number,
): Array<Pulse> {
  return [{ gpioOn: 0, gpioOff: ledPin, usDelay: duration }];
}

export function bitArrayToWave(
  bitArray: Array<boolean>,
  ledPin: number,
): Array<Pulse> {
  const wave: Array<Pulse> = [];

  for (const bit of bitArray) {
    wave.push(...highWaveFromDuration(NEC_PULSE_US, ledPin));
    wave.push({
      gpioOn: 0,
      gpioOff: ledPin,
      // NEC signals a 1 bit with the long gap, a 0 bit with the short one --
      // this had it backwards, which silently transmitted the bitwise
      // complement of every command (e.g. address 0x7c went out as 0x83).
      usDelay: bit ? NEC_LONG_GAP_US : NEC_PULSE_US,
    });
  }

  return wave;
}
