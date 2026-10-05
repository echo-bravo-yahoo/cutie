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
  transmitWave,
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

export function necToBits({
  address,
  command,
  extendedAddress,
  extendedCommand,
}: NECCommand): Array<boolean> {
  const invert = (bits: Array<boolean>) => bits.map((bit) => !bit);

  const addressBits = numberToBitArray(address, 8);
  const subdeviceBits =
    extendedAddress === undefined
      ? invert(numberToBitArray(address, 8))
      : numberToBitArray(extendedAddress, 8);

  const commandBits = numberToBitArray(command, 8);
  const extendedCommandBits =
    extendedCommand === undefined
      ? invert(numberToBitArray(command, 8))
      : numberToBitArray(extendedCommand, 8);

  return [
    ...addressBits,
    ...subdeviceBits,
    ...commandBits,
    ...extendedCommandBits,
  ];
}

export function necBitsToCommand(bits: Array<boolean>): NECCommand {
  const byte = (start: number) => bitArrayToByte(bits.slice(start, start + 8));

  return {
    address: byte(0),
    extendedAddress: byte(8),
    command: byte(16),
    extendedCommand: byte(24),
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
  carrierFrequencyHz?: number,
): Array<Pulse> {
  // the first two pulses are the NEC start header; the last signals the end
  // of transmission
  return [
    ...highWaveFromDuration(NEC_HEADER_HIGH_US, ledPin, carrierFrequencyHz),
    ...lowWaveFromDuration(NEC_HEADER_LOW_US, ledPin),
    ...bitArrayToWave(necToBits(necCommand), ledPin, carrierFrequencyHz),
    ...highWaveFromDuration(NEC_TRAILER_US, ledPin, carrierFrequencyHz),
  ];
}

export async function transmitNECCommand(
  pigpioClient: PigpioClient,
  necCommand: NECCommand,
  ledPin: number,
  carrierFrequencyHz?: number,
): Promise<void> {
  await transmitWave(
    pigpioClient,
    necToWave(necCommand, ledPin, carrierFrequencyHz),
    ledPin,
  );
}
