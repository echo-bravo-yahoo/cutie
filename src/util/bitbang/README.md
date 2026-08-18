### Bitbang

Waveform helpers for driving an infrared LED through `pigpio`.

`helpers.ts` builds pigpio generic waveforms from durations and bit arrays, `pulse.ts` waits for a transmit to drain, and `adapters/nec.ts` encodes an NEC address/command pair into a wave and transmits it. `output:nec` is the only consumer.

This was once a standalone CommonJS sub-package with its own `package.json`. It now compiles as part of the main build; the receive-side decoders and the other protocol adapters were dropped rather than ported, and remain in git history.
