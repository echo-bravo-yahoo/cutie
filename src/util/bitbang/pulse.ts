import { Pulse } from "./helpers.js";

// The slice of pigpio's module-level API the waveform code uses. pigpio ships
// no types and is an optional dependency, so this stands in for both.
export interface Pigpio {
  waveClear(): void;
  waveAddGeneric(pulses: Array<Pulse>): void;
  waveCreate(): number;
  waveDelete(waveId: number): void;
  waveTxSend(waveId: number, mode: number): void;
  waveTxBusy(): boolean;
  WAVE_MODE_ONE_SHOT: number;
}

// Resolves once pigpio reports the transmit queue has drained.
export function checkWave(pigpio: Pigpio): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      if (pigpio.waveTxBusy()) {
        setImmediate(poll);
      } else {
        resolve();
      }
    };

    poll();
  });
}
