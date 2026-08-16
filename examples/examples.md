Run any of these with `cutie start --config ./examples/<name>.yaml`.

These are best read in this order:

1. `clock.yaml` introduces tasks, triggers, and messages
2. `remote-clock.yaml` introduces connections
3. `basic-sensors.yaml` introduces reads
4. `json-manipulation.yaml` introduces transforms
5. `interpolation.yaml` introduces the stash
6. `env-interpolation.yaml` reads values from the environment
7. `remote-config.yaml` fetches the config itself from a connection

`remote-clock.yaml` and `remote-config.yaml` need an MQTT broker on `mqtt://127.0.0.1:1883`; the rest run with no hardware and no network.

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

A display takes pixels and nothing else, so anything that produces pixels can feed one. To render a reading, put a step that draws it in front of the display and hand over the bitmap:

```json
{
  "type": "transform:javascript",
  "codePath": "./config/temperature-bar.js"
},
{
  "type": "output:inky-phat",
  "source": "bitmap",
  "path": "frame",
  "panelColor": "yellow"
}
```

