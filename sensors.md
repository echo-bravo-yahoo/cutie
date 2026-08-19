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

Every sensor is built this way. There is no sensor-shaped trigger that samples on its own schedule and aggregates for you; that form existed until 4.0 and was removed, because it was no more capable than these three steps and hid the sampling schedule and the aggregation inside one module's options. [Sampling by hand](#sampling-by-hand) is the shape that replaces it.

`virtual: true` fakes plausible values that drift slowly over time instead of touching hardware, which is how to develop on a machine with no sensor attached. It is not universal: `read:bme280`, `read:bme680`, `read:ble`, and `read:file` accept it, and a read with nothing external to stand in for -- `read:constant`, `read:random`, `read:stash` -- rejects it rather than quietly ignoring it. `read:random` needs no `virtual` because every reading it produces is already synthetic.

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

## `read:ble`

Presence tracking. One scan per message, reporting the Bluetooth signal strength of named devices, which is a proxy for how close each one is. Emits `{ metadata: { timestamp }, devices: { "<label>": { rssi } } }`.

| Field              | Default | Meaning                                                    |
| ------------------ | ------- | ---------------------------------------------------------- |
| `devices`          | --      | `[{ "address": "00:00:00:00:00:00", "label": "phone" }]`   |
| `adapter`          | --      | which adapter to scan with, e.g. `hci0`; default otherwise |
| `discoveryTimeout` | `10s`   | how long to wait for a device before leaving it out        |
| `virtual`          | `false` | fake RSSI instead of scanning for BLE advertisements       |

`label` is optional and defaults to the address; it is the key that device's reading appears under. A device that does not turn up within `discoveryTimeout` is left out of `devices` entirely, so absence reads as absence rather than as a very weak signal.

```yaml
tasks:
  who-is-home:
    trigger:
      type: "trigger:cron"
      expression: "*/1 * * * *"
    steps:
      - type: "read:ble"
        devices:
          - address: "00:00:00:00:00:00"
            label: "phone"
      - type: "output:console"
```

## `read:ltr559`

Ambient light and proximity over I2C. Emits `{ metadata: { timestamp }, lux, proximity }`.

| Field        | Default | Meaning                                          |
| ------------ | ------- | ------------------------------------------------ |
| `i2cAddress` | `0x23`  | I2C address of the sensor                        |
| `virtual`    | `false` | fake the readings instead of opening the I2C bus |

## `read:mems-mic`

Sound level from a MEMS I2S digital microphone, over ALSA. Each "sample" is itself a multi-second audio capture, so pair it with `trigger:repeat` and let one longer capture per read stand in for the [accumulate-and-aggregate smoothing](#sampling-by-hand) a faster sensor needs. Emits `{ metadata: { timestamp }, soundLevel }` - dBFS, relative to full scale. Not a calibrated absolute dB SPL reading; an uncalibrated MEMS mic has no basis for one.

| Field            | Default        | Meaning                                              |
| ---------------- | -------------- | ---------------------------------------------------- |
| `alsaDevice`     | none, required | ALSA capture device, e.g. `"plughw:CARD=<id>,DEV=0"` |
| `captureSeconds` | `2`            | length of the capture each read performs             |
| `virtual`        | `false`        | fake the level instead of capturing audio            |

```yaml
tasks:
  mic:
    trigger:
      type: "trigger:repeat"
      interval: 30000
    steps:
      - type: "read:mems-mic"
        virtual: true
        alsaDevice: "plughw:CARD=sndrpigooglevoi,DEV=0"
      - type: "output:console"
```

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

To sample faster than you report, batch the readings and aggregate the batch. `transform:accumulate` gathers them and `transform:aggregate` collapses them:

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
