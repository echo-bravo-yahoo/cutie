### Bitbang

Waveform helpers for driving an infrared LED through `pigpiod` (the pigpio daemon), reached over its socket protocol via `pigpio-client`.

`helpers.ts` builds `Pulse` arrays (which pin, on or off, and for how long) from durations and bit arrays. `adapters/nec.ts` encodes an NEC address/command pair into a wave, translates each `Pulse` into the `[setFlag, clearFlag, delayUs]` triplet `pigpio-client`'s `waveAddPulse` expects, and transmits it, waiting on `pigpio-client`'s own `waveNotBusy()` for the transmit to drain. `output:nec` is the only consumer. The shared `pigpiod` socket connection lives in `../pigpio-client.ts`, one connection shared by every GPIO-driving trigger/output.

This was once a standalone CommonJS sub-package with its own `package.json`. It now compiles as part of the main build. NEC receive-side decoding lives in `adapters/nec.ts` (`NECFrameDecoder`, `necBitsToCommand`) and `../../triggers/nec.ts`; the other protocols' receive-side code (Mitsubishi AC, raw capture, serial-fed capture) is still only in git history.