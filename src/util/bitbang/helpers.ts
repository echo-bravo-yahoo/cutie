// Waveform helpers for bit-banging an infrared carrier through pigpiod (the
// pigpio daemon), reached over its socket protocol via pigpio-client.
// Ported from the vendored CommonJS "bitbang" sub-package; only the pieces the
// NEC transmit path reaches came across. NEC receive-side decoding lives in
// adapters/nec.ts; the other protocols' receive-side code and the terminal
// graphing helper were left behind in git history.

import { PigpioClient, withWaveLock } from "../pigpio-client.js";

// One entry of a pigpio generic waveform: which pins to drive high, which to
// drive low, and how long to hold that state, in microseconds.
export interface Pulse {
  gpioOn: number;
  gpioOff: number;
  usDelay: number;
}

export const DEFAULT_CARRIER_FREQUENCY_HZ = 38400;
// NEC recommends 1/3 (sbprojects.net/knowledge/ir/nec.php); most demodulators
// tolerate a wide range, but there's no reason to drift from the spec.
const CARRIER_DUTY_CYCLE = 1 / 3;
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
  carrierFrequencyHz: number = DEFAULT_CARRIER_FREQUENCY_HZ,
): Array<Pulse> {
  const usDelay = US_PER_SECOND / carrierFrequencyHz;
  const cycles = Math.round((duration * carrierFrequencyHz) / US_PER_SECOND);
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
  carrierFrequencyHz?: number,
): Array<Pulse> {
  const wave: Array<Pulse> = [];

  for (const bit of bitArray) {
    wave.push(
      ...highWaveFromDuration(NEC_PULSE_US, ledPin, carrierFrequencyHz),
    );
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

// Translates the Pulse shape above (gpioOn/gpioOff hold either the pin
// number or 0) into pigpio-client's waveAddPulse triplet shape: [setFlag,
// clearFlag, delayUs]. setFlag/clearFlag must be 0/1 -- pigpio-client shifts
// them into a bitmask itself via "<< gpio" for whichever pin the bound gpio
// object represents, so passing the raw pin number here (matching Pulse's
// own convention) would silently build the wrong bitmask.
export function pulseToTriplet(
  pulse: Pulse,
  ledPin: number,
): [number, number, number] {
  return [
    pulse.gpioOn === ledPin ? 1 : 0,
    pulse.gpioOff === ledPin ? 1 : 0,
    pulse.usDelay,
  ];
}

// pigpio-client's own default poll interval (25ms) means a full NEC frame
// (50.1-86.1ms depending on payload) needs 2-4 waveBusy round-trips on this
// connection's command socket to confirm completion. Each round-trip is
// traffic pigpiod has to service while its one daemon-wide alert-delivery
// thread is also trying to feed every OTHER connection's notify() data --
// empirically, transmitting from one process silently starved a notify()-
// only listener in a separate process for the transmission's duration.
// Polling past the worst case (32 bits all long-gap: 9000 + 4500 +
// 32*(563+1688) + 563 = 86095us) means pigpiod is asked exactly once,
// instead of repeatedly while it may still be contending for attention.
// output:infrared's raw pulse trains reuse this same interval for the same
// reason, at whatever coarser grain their own length implies.
export const WAVE_COMPLETION_POLL_INTERVAL_MS = 100;

// Any Pulse[] -- an NEC frame or a raw capture alike -- transmitted the same
// way: clear pigpiod's one global wave slot, load it, send it once, poll
// until it finishes, then delete it. withWaveLock serializes this against
// every other wave-touching caller in this process, because pigpiod's wave
// state is not scoped per connection or per pin (see withWaveLock's own
// comment in pigpio-client.ts).
export async function transmitWave(
  pigpioClient: PigpioClient,
  pulses: Array<Pulse>,
  ledPin: number,
): Promise<void> {
  const gpio = pigpioClient.gpio(ledPin);
  const triplets = pulses.map((pulse) => pulseToTriplet(pulse, ledPin));

  await withWaveLock(async () => {
    await gpio.waveClear();
    await gpio.waveAddPulse(triplets);
    const waveId = await gpio.waveCreate();

    try {
      // TODO: figure out why WAVE_MODE_ONE_SHOT_SYNC binds things up -- same
      // open question as the pigpio-based version this replaced.
      await gpio.waveSendOnce(waveId);
      await gpio.waveNotBusy(WAVE_COMPLETION_POLL_INTERVAL_MS);
    } finally {
      await gpio.waveDelete(waveId);
    }
  });
}

// A generic raw pulse train: relative microsecond durations, alternating
// LED-on/LED-off, always starting on -- the same convention trigger:infrared
// + transform:debounce + transform:ir-pulses produce, so a captured code
// replays through output:infrared with no further conversion.
export function rawPulsesToWave(
  durationsUs: Array<number>,
  ledPin: number,
  carrierFrequencyHz?: number,
): Array<Pulse> {
  return durationsUs.flatMap((duration, index) =>
    index % 2 === 0
      ? highWaveFromDuration(duration, ledPin, carrierFrequencyHz)
      : lowWaveFromDuration(duration, ledPin),
  );
}
