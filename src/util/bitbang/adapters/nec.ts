// https://www.sbprojects.net/knowledge/ir/nec.php
// https://techdocs.altium.com/display/FPGA/NEC+Infrared+Transmission+Protocol

import {
  bitArrayToByte,
  bitArrayToWave,
  highWaveFromDuration,
  is,
  lowWaveFromDuration,
  NEC_LONG_GAP_US,
  NEC_PULSE_US,
  numberToBitArray,
  Pulse,
} from "../helpers.js";
import { PigpioClient } from "../../pigpio-client.js";

export const NEC_HEADER_HIGH_US = 9000;
export const NEC_HEADER_LOW_US = 4500;
export const NEC_TRAILER_US = 563;

export interface NECCommand {
  address: number;
  command: number;
  extendedAddress?: number;
  extendedCommand?: number;
}

// The address halves are both inverted here while the command halves are not.
// That asymmetry is not what the published NEC spec describes, but it is what
// drives the hardware this was written against, so it is preserved verbatim --
// do not "correct" it without a receiver to test against.
export function necToBits({
  address,
  command,
  extendedAddress,
  extendedCommand,
}: NECCommand): Array<boolean> {
  const invert = (bits: Array<boolean>) => bits.map((bit) => !bit);

  const extendedAddressBits = invert(numberToBitArray(address, 8));
  const addressBits = invert(numberToBitArray(extendedAddress ?? address, 8));

  const commandBits = numberToBitArray(command, 8);
  const extendedCommandBits =
    extendedCommand === undefined
      ? invert(numberToBitArray(command, 8))
      : numberToBitArray(extendedCommand, 8);

  return [
    ...addressBits,
    ...extendedAddressBits,
    ...commandBits,
    ...extendedCommandBits,
  ];
}

// The exact structural inverse of necToBits, preserving the same asymmetric
// inversion (see the comment above necToBits) so encode and decode stay
// inverses of each other. Always returns all four fields; see the
// necToBits comment for why "was extendedAddress/extendedCommand actually
// given" can't be reliably recovered from the bits alone.
export function necBitsToCommand(bits: Array<boolean>): NECCommand {
  const invert = (byteBits: Array<boolean>) => byteBits.map((bit) => !bit);
  const byte = (start: number, inverted: boolean) => {
    const slice = bits.slice(start, start + 8);
    return bitArrayToByte(inverted ? invert(slice) : slice);
  };

  return {
    address: byte(8, true),
    extendedAddress: byte(0, true),
    command: byte(16, false),
    extendedCommand: byte(24, false),
  };
}

type NECDecodePhase =
  | "headerMark"
  | "headerSpace"
  | "bitMark"
  | "bitSpace"
  | "trailerMark";

// A pure, pigpio-free edge-by-edge NEC frame state machine: consumeEdge
// takes exactly what pigpio's "alert" callback reports and returns a
// decoded command once a full frame completes, undefined otherwise. Noise
// or an unrelated IR signal fails to match an expected segment and resets
// the state machine rather than corrupting a partial frame.
export class NECFrameDecoder {
  private activeLow: boolean;
  private phase: NECDecodePhase;
  private bits: Array<boolean>;
  private previousLevel?: number;
  private previousTick?: number;

  constructor(activeLow = true) {
    this.activeLow = activeLow;
    this.phase = "headerMark";
    this.bits = [];
  }

  private reset() {
    this.phase = "headerMark";
    this.bits = [];
  }

  consumeEdge(level: number, tick: number): NECCommand | undefined {
    if (level !== 0 && level !== 1) return undefined;

    const markLevel = this.activeLow ? 0 : 1;
    let result: NECCommand | undefined;

    if (this.previousTick !== undefined && this.previousLevel !== undefined) {
      // pigpio's tick is an unsigned 32-bit microsecond counter that wraps
      // roughly every 72 minutes; ">>> 0" reinterprets the subtraction as
      // unsigned so a wrap doesn't produce a negative duration.
      const duration = (tick - this.previousTick) >>> 0;
      result = this.consumeSegment(this.previousLevel, duration, markLevel);
    }

    this.previousLevel = level;
    this.previousTick = tick;

    return result;
  }

  private consumeSegment(
    level: number,
    duration: number,
    markLevel: number,
  ): NECCommand | undefined {
    const spaceLevel = markLevel === 0 ? 1 : 0;

    switch (this.phase) {
      case "headerMark":
        if (level === markLevel && is(duration, NEC_HEADER_HIGH_US))
          this.phase = "headerSpace";
        else this.reset();
        return undefined;

      case "headerSpace":
        if (level === spaceLevel && is(duration, NEC_HEADER_LOW_US))
          this.phase = "bitMark";
        else this.reset();
        return undefined;

      case "bitMark":
        if (level === markLevel && is(duration, NEC_PULSE_US))
          this.phase = "bitSpace";
        else this.reset();
        return undefined;

      case "bitSpace":
        if (level === spaceLevel && is(duration, NEC_PULSE_US)) {
          this.bits.push(false);
        } else if (level === spaceLevel && is(duration, NEC_LONG_GAP_US)) {
          this.bits.push(true);
        } else {
          this.reset();
          return undefined;
        }

        this.phase = this.bits.length === 32 ? "trailerMark" : "bitMark";
        return undefined;

      case "trailerMark": {
        const command =
          level === markLevel && is(duration, NEC_TRAILER_US)
            ? necBitsToCommand(this.bits)
            : undefined;
        this.reset();
        return command;
      }
    }
  }
}

export function necToWave(
  necCommand: NECCommand,
  ledPin: number,
): Array<Pulse> {
  // the first two pulses are the NEC start header; the last signals the end
  // of transmission
  return [
    ...highWaveFromDuration(NEC_HEADER_HIGH_US, ledPin),
    ...lowWaveFromDuration(NEC_HEADER_LOW_US, ledPin),
    ...bitArrayToWave(necToBits(necCommand), ledPin),
    ...highWaveFromDuration(NEC_TRAILER_US, ledPin),
  ];
}

// Translates the existing Pulse shape (gpioOn/gpioOff hold either the pin
// number or 0, unchanged in helpers.ts/necToWave) into pigpio-client's
// waveAddPulse triplet shape: [setFlag, clearFlag, delayUs]. setFlag/
// clearFlag must be 0/1 -- pigpio-client shifts them into a bitmask itself
// via "<< gpio" for whichever pin the bound gpio object represents, so
// passing the raw pin number here (matching Pulse's own convention) would
// silently build the wrong bitmask.
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

export async function transmitNECCommand(
  pigpioClient: PigpioClient,
  necCommand: NECCommand,
  ledPin: number,
): Promise<void> {
  const gpio = pigpioClient.gpio(ledPin);
  const triplets = necToWave(necCommand, ledPin).map((pulse) =>
    pulseToTriplet(pulse, ledPin),
  );

  await gpio.waveClear();
  await gpio.waveAddPulse(triplets);
  const waveId = await gpio.waveCreate();

  try {
    // TODO: figure out why WAVE_MODE_ONE_SHOT_SYNC binds things up -- same
    // open question as the pigpio-based version this replaced.
    await gpio.waveSendOnce(waveId);
    await gpio.waveNotBusy();
  } finally {
    await gpio.waveDelete(waveId);
  }
}
