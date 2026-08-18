// https://www.sbprojects.net/knowledge/ir/nec.php
// https://techdocs.altium.com/display/FPGA/NEC+Infrared+Transmission+Protocol

import {
  bitArrayToWave,
  highWaveFromDuration,
  lowWaveFromDuration,
  numberToBitArray,
  Pulse,
} from "../helpers.js";
import { checkWave, Pigpio } from "../pulse.js";

const NEC_HEADER_HIGH_US = 9000;
const NEC_HEADER_LOW_US = 4500;
const NEC_TRAILER_US = 563;

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

export async function transmitNECCommand(
  pigpio: Pigpio,
  necCommand: NECCommand,
  ledPin: number,
): Promise<void> {
  pigpio.waveClear();
  pigpio.waveAddGeneric(necToWave(necCommand, ledPin));
  const waveId = pigpio.waveCreate();

  try {
    // TODO: figure out why WAVE_MODE_ONE_SHOT_SYNC binds things up
    pigpio.waveTxSend(waveId, pigpio.WAVE_MODE_ONE_SHOT);
    // The v3 code passed a callback checkWave never accepted, so this promise
    // never settled and the wave was deleted while still transmitting.
    await checkWave(pigpio);
  } finally {
    pigpio.waveDelete(waveId);
  }
}
