Run any of these with `cutie start --config ./examples/<name>.yaml`.

These are best read in this order:

1. `clock.yaml` introduces tasks, triggers, and messages
2. `remote-clock.yaml` introduces connections
3. `basic-sensors.yaml` introduces reads
4. `json-manipulation.yaml` introduces transforms
5. `interpolation.yaml` introduces the stash
6. `env-interpolation.yaml` reads values from the environment
7. `remote-config.yaml` fetches the config itself from a connection

`remote-clock.yaml` and `remote-config.yaml` need an MQTT broker on `mqtt://127.0.0.1:1883`. The rest need no hardware and no network, but `interpolation.yaml` does touch the filesystem: it watches this directory and copies whatever changes into `./examples/copies/`. Every relative path in a config resolves against the config file's own directory, which is why those paths are relative to `examples/` rather than to wherever you ran `cutie` from.

## Display test patterns

`display-test-pattern.mjs` writes two PNGs sized for a display output, to check a panel's wiring rather than to show a reading:

```bash
node examples/display-test-pattern.mjs --panel inky-phat --out /tmp
node examples/display-test-pattern.mjs --panel unicorn-hat-mini --out /tmp
```

The checkerboard catches transposition and stride errors, which turn an even grid into stripes or a scatter. The bands paint one column per colour the panel can show, in a fixed order, so the drawn order reads back whether the colours map to what they should -- something a single-colour pattern cannot show, since it cannot tell "this colour works" from "this colour silently fell back to black". Pass `--panel-color` to match the output's `panelColor`, or the bands test what the file holds rather than what the panel does.

Copy a pattern to the device and draw it like any other image:

```json
{
  "type": "output:inky-phat",
  "source": "image",
  "file": "/home/pi/inky-phat-checkerboard.png",
  "panelColor": "yellow",
  "minRefreshMs": 0
}
```

## Rendering a reading

A display takes pixels and nothing else, so anything that produces pixels can feed one. To show a reading, put a step that draws it in front of the display and hand over the bitmap.

`temperature-frames.js` is a worked example: it turns `message.temp` into a bar for the Inky and a gauge for the Unicorn, which is what the two displays used to draw for themselves. Copy it onto the device, since `codePath` resolves against the cutie directory rather than this repository:

```json
{
  "steps": [
    {
      "type": "transform:javascript",
      "codePath": "./config/temperature-frames.js",
      "outputType": "object"
    },
    {
      "type": "output:unicorn-hat-mini",
      "source": "bitmap",
      "path": "unicornFrame",
      "brightness": 0.3
    },
    {
      "type": "output:inky-phat",
      "source": "bitmap",
      "path": "inkyFrame",
      "panelColor": "yellow",
      "minRefreshMs": 900000
    }
  ]
}
```

The script runs under `node:vm` with nothing in scope but `message`, so there is no `Buffer` to base64 with -- it returns plain arrays of numbers, which the bitmap format accepts equally. Its last expression is the message that continues down the pipeline.
