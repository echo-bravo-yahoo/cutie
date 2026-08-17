# Sensors

`cutie` supports two kinds of sensor, and the difference decides where the sensor goes in a task.

- A **read** is a step. It sits in `steps` and replaces the message with a fresh reading each time something else triggers the task. Pair it with a trigger such as `trigger:repeat`.
- A **sensor trigger** starts the task itself. It samples on its own schedule, aggregates the samples, and emits a reading. It goes in `trigger`.

Every hardware-backed sensor supports `virtual: true`, which fakes plausible values that drift slowly over time instead of touching hardware. Use it to develop on a machine with no sensor attached.

The display outputs -- `output:inky-phat` and `output:unicorn-hat-mini` -- take `virtual: true` as well, and theirs still does the image work: the source is loaded, scaled, quantised and length-checked exactly as for a real draw, and each message logs what would have appeared on the panel. That makes a display config developable on a workstation, since the only thing skipped is the panel itself.

## `read:bme280`

Temperature, humidity, and barometric pressure over I2C.

| Field        | Default | Meaning                                          |
| ------------ | ------- | ------------------------------------------------ |
| `i2cAddress` | `0x76`  | I2C address of the sensor                        |
| `virtual`    | `false` | fake the readings instead of opening the I2C bus |
| `disabled`   | `false` | skip this step entirely                          |

Emits `{ metadata: { timestamp }, temp, humidity, pressure }`.

```yaml
tasks:
  thermometer:
    trigger:
      type: "trigger:repeat"
      interval: 1000
    steps:
      - type: "read:bme280"
        virtual: true
      - type: "output:console"
```

## `read:bme680`

Everything the BME280 reads, plus a gas-resistance channel that tracks volatile organic compounds.

| Field        | Default | Meaning                                          |
| ------------ | ------- | ------------------------------------------------ |
| `i2cAddress` | `0x77`  | I2C address of the sensor                        |
| `virtual`    | `false` | fake the readings instead of opening the I2C bus |
| `disabled`   | `false` | skip this step entirely                          |

Emits `{ metadata: { timestamp }, temp, humidity, pressure, gas }`.

## `trigger:random`

A software sensor that walks a number randomly within bounds. It needs no hardware, so it is the quickest way to exercise a transform chain or a new output.

| Field               | Default   | Meaning                                   |
| ------------------- | --------- | ----------------------------------------- |
| `start`             | `0`       | first value                               |
| `min` / `max`       | --        | bounds the walk stays inside              |
| `minStep`/`maxStep` | --        | how far one sample may move from the last |
| `samplingInterval`  | `60000`   | ms between samples                        |
| `reportingInterval` | `60000`   | ms between emitted messages               |
| `sampling`          | undefined | `{ "aggregation": ... }`, see below       |

```yaml
tasks:
  fake-thermometer:
    trigger:
      type: "trigger:random"
      start: 24
      min: 18
      max: 32
      minStep: 0.05
      maxStep: 0.35
      samplingInterval: 1000
      reportingInterval: 5000
    steps:
      - type: "output:console"
```

## `trigger:ble-tracker`

Presence tracking. It watches for BLE advertisements from named devices and reports each device's signal strength, which is a proxy for how close the device is.

| Field | Default | Meaning |
| --- | --- | --- |
| `devices` | -- | `[{ "alias": "phone", "macAddress": "..." }]` |
| `samplingInterval` | `60000` | ms between samples |
| `reportingInterval` | `60000` | ms between emitted messages |
| `virtual` | `false` | fake RSSI instead of scanning for BLE advertisements |

`alias` is optional and defaults to the MAC address; it is the key each device's reading appears under. Emits `{ "<alias>": { metadata: { timestamp }, rssi } }` per device seen since the last report. Devices that never advertise are omitted rather than reported as absent.

```yaml
tasks:
  who-is-home:
    trigger:
      type: "trigger:ble-tracker"
      samplingInterval: 10000
      reportingInterval: 60000
      virtual: true
      devices:
        - alias: "phone"
          macAddress: "00:00:00:00:00:00"
    steps:
      - type: "output:console"
```

## Sampling and aggregation

A sensor trigger samples more often than it reports, so several samples collapse into one reported value. Set `sampling.aggregation` to choose how:

| Value     | Result                                                     |
| --------- | ---------------------------------------------------------- |
| `latest`  | the most recent sample                                     |
| `average` | the arithmetic mean                                        |
| `sum`     | the total                                                  |
| `median`  | the middle value, equivalent to `p50`                      |
| `pX`      | the Xth percentile, e.g. `p95`; fractional values are fine |

Percentiles interpolate linearly between the two closest samples, matching numpy's default and InfluxDB's `PERCENTILE`, so values computed here compare against values computed in those tools. A single sample always reports as `latest` regardless of this setting.

The same aggregations are available as a transform, `transform:aggregate`, for aggregating arrays that arrive from somewhere else.
