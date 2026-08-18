# Sensors

The way to read a sensor is a task built from three steps that each do one thing:

1. a **trigger** decides when to sample, usually `trigger:cron` or `trigger:repeat`
2. a **read** takes the reading and replaces the message with it
3. a **transform** collapses a batch of readings, if you are batching at all

```yaml
tasks:
  thermometer:
    trigger:
      type: "trigger:repeat"
      interval: "1s"
    steps:
      - type: "read:bme280"
        virtual: true
      - type: "output:console"
```

There is also an older form, a **sensor trigger** such as `trigger:random` or `trigger:ble-tracker`, which fuses all three: it samples on its own schedule, aggregates the samples itself, and emits the result. It is deprecated. Nothing about it is more capable than the three-step form, and it hides the sampling schedule and the aggregation inside one module's options. New configs should not use it; see [Sampling by hand](#sampling-by-hand) for the shape that replaces it.

`virtual: true` fakes plausible values that drift slowly over time instead of touching hardware, which is how to develop on a machine with no sensor attached. It is not universal: `read:bme280`, `read:bme680`, and `read:file` accept it, and a read with nothing external to stand in for -- `read:constant`, `read:random`, `read:stash` -- rejects it rather than quietly ignoring it. `read:random` needs no `virtual` because every reading it produces is already synthetic.

The hardware-backed outputs take `virtual: true` as well: `output:switchbots`, `output:thermal-printer`, `output:nec`, and the two displays. The display outputs' version still does the image work -- the source is loaded, scaled, quantised and length-checked exactly as for a real draw, and each message logs what would have appeared on the panel -- which makes a display config developable on a workstation, since the only thing skipped is the panel itself.

Full option tables for all of these live in [the configuration reference](./docs/reference/README.md), which is generated from the schemas `cutie validate` checks against.

## `read:bme280`

Temperature, humidity, and barometric pressure over I2C. Emits `{ metadata: { timestamp }, temp, humidity, pressure }`.

| Field        | Default | Meaning                                          |
| ------------ | ------- | ------------------------------------------------ |
| `i2cAddress` | `0x76`  | I2C address of the sensor, between 8 and 119     |
| `virtual`    | `false` | fake the readings instead of opening the I2C bus |

## `read:bme680`

Everything the BME280 reads, plus a gas-resistance channel that tracks volatile organic compounds. Emits `{ metadata: { timestamp }, temp, humidity, pressure, gas }`.

| Field        | Default | Meaning                                          |
| ------------ | ------- | ------------------------------------------------ |
| `i2cAddress` | `0x77`  | I2C address of the sensor, between 8 and 119     |
| `virtual`    | `false` | fake the readings instead of opening the I2C bus |

## `read:random`

A number that drifts within bounds, one step at a time, with no hardware attached. Put it where a real sensor's read would go and the rest of the task behaves identically, which makes it the quickest way to exercise a transform chain or a new output.

Every bound is required. Left to default, they would have produced `NaN` on every reading with no error, which is why there is no default to leave them at.

| Field                 | Meaning                                      |
| --------------------- | -------------------------------------------- |
| `start`               | the value the first reading drifts away from |
| `min` / `max`         | bounds the walk stays inside                 |
| `minStep` / `maxStep` | how far one reading may move from the last   |

```yaml
tasks:
  fake-thermometer:
    trigger:
      type: "trigger:repeat"
      interval: "1s"
    steps:
      - type: "read:random"
        start: 24
        min: 18
        max: 32
        minStep: 0.05
        maxStep: 0.35
      - type: "output:console"
```

## Sampling by hand

To sample faster than you report, batch the readings and aggregate the batch. `transform:accumulate` gathers them and `transform:aggregate` collapses them, which is what a sensor trigger used to do behind `samplingInterval`, `reportingInterval`, and `sampling.aggregation`:

```yaml
tasks:
  averaged-thermometer:
    trigger:
      # sample once a second
      type: "trigger:repeat"
      interval: "1s"
    steps:
      - type: "read:bme280"
        virtual: true
      # report every five samples, or after ten seconds if they arrive slower
      - type: "transform:accumulate"
        count: 5
        maxAge: "10s"
      - type: "transform:aggregate"
        paths:
          temp:
            aggregation: "average"
          humidity:
            aggregation: "average"
          pressure:
            aggregation: "latest"
      - type: "output:console"
```

Set `aggregation` to one of:

| Value     | Result                                                     |
| --------- | ---------------------------------------------------------- |
| `latest`  | the most recent sample                                     |
| `average` | the arithmetic mean                                        |
| `sum`     | the total                                                  |
| `median`  | the middle value, equivalent to `p50`                      |
| `pX`      | the Xth percentile, e.g. `p95`; fractional values are fine |

Percentiles interpolate linearly between the two closest samples, matching numpy's default and InfluxDB's `PERCENTILE`, so values computed here compare against values computed in those tools. A single sample always reports as `latest` regardless of this setting.

## Deprecated: `trigger:random`

A sensor trigger that walks a number randomly within bounds. Use `trigger:repeat` into `read:random` instead; the example above is the direct replacement.

| Field | Default | Meaning |
| --- | --- | --- |
| `start` | -- | first value |
| `min` / `max` | -- | bounds the walk stays inside |
| `minStep` / `maxStep` | -- | how far one sample may move from the last |
| `samplingInterval` | `60000` | ms between samples |
| `reportingInterval` | `60000` | ms between emitted messages |
| `sampling` | undefined | `{ "aggregation": ... }` |

`sampling` is listed as optional but is required in practice: whenever sampling outpaces reporting there is more than one sample to collapse, and without it the collapse fails. That mismatch is one of the reasons this form is deprecated.

## Deprecated: `trigger:ble-tracker`

Presence tracking. It watches for BLE advertisements from named devices and reports each device's signal strength, which is a proxy for how close the device is.

There is no `read:ble` to pair with `trigger:cron` yet, so this remains the only way to do BLE presence tracking. Treat the shape as unstable.

| Field | Default | Meaning |
| --- | --- | --- |
| `devices` | -- | `[{ "alias": "phone", "macAddress": "..." }]` |
| `samplingInterval` | `60000` | ms between samples |
| `reportingInterval` | `60000` | ms between emitted messages |
| `virtual` | `false` | fake RSSI instead of scanning for BLE advertisements |

`alias` is optional and defaults to the MAC address; it is the key each device's reading appears under. Emits `{ "<alias>": { metadata: { timestamp }, rssi } }` per device.

One rough edge to know about: a device that never advertises is reported at an `rssi` of `-99` rather than being left out, so absence looks like a very weak signal rather than as absence.

```yaml
tasks:
  who-is-home:
    trigger:
      type: "trigger:ble-tracker"
      samplingInterval: 10000
      reportingInterval: 60000
      sampling:
        aggregation: "average"
      devices:
        - alias: "phone"
          macAddress: "00:00:00:00:00:00"
    steps:
      - type: "output:console"
```
