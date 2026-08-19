# Changelog

## Unreleased

Every module now declares its options in a schema, and `cutie` checks a config against those schemas before it opens a socket or drives a pin. Run `cutie validate` to see everything wrong with a config at once. The full option tables are generated from the same schemas into [docs/reference](./docs/reference/README.md).

### Breaking

- `trigger:mqtt` and `output:mqtt` require `topics` as an array. Neither accepts a singular `topic` any more. There is no deprecation period and no alias: a config naming `topic` is rejected with `topics` named as the missing option.
- `output:file`'s `insertNewlines` now writes the newline **after** each message rather than before it. Files an existing config already writes will change: the leading blank line goes away and the last line gains its terminator.
- `output:switchbots` renames `bots: [{id, name, reverseOnOff}]` to `devices: [{address, label, reverseOnOff}]`. The old keys are rejected rather than accepted quietly; `name` in particular collided with the `name` every step accepts.
- `output:thermal-printer` renames `path` to `devicePath` and requires it unless `virtual` is set. A `path` everywhere else in a config is a filesystem path, and this is a serial device. There is no longer a default of `/dev/ttyS0`.
- `output:nec` requires `ledPin` unless `virtual` is set. The old default of `23` was a guess about someone else's wiring.
- `read:random` requires `min`, `max`, `minStep`, `maxStep`, and `start`. Omitting any one of them used to produce `NaN` on every reading, silently.
- `trigger:infrared` no longer accepts `ledPin`. It configured an output pin the module never transmitted on.
- `transform:shell` and `transform:javascript` require `outputType`. Pass `any` for the uncoerced passthrough that `transform:javascript` used to do by default.
- `transform:accumulate` requires `count`.
- `transform:uglify` rejects `spaces`. It is `transform:prettify` with no indentation; use `transform:prettify` with a `spaces` of `0` to say so.
- A relative path in a config now resolves against the directory holding the config file rather than the process's working directory. This affects `read:file`, `output:file`, `trigger:file-change`, and `codePath`.
- A disabled step is left out of the task's chain entirely rather than linked and skipped, so it no longer runs its side effect. A disabled `output:console` used to keep printing.
- An output now passes its input on unchanged. A `send()` return value is no longer read, so a step after an output sees the message the output was handed.
- The stash belongs to one message rather than to the task, which is what `examples/interpolation.yaml` always claimed. Two messages in flight no longer share it, and it is no longer reachable from outside the message.
- `output:stash` writes with a path setter, so a dotted key such as `device.name` nests the way `read:stash` reads it back rather than creating a literal flat key of that name.
- `trigger:logs` defaults `minVerbosity` to `warn` rather than `trace`. A logs task that wants everything has to ask for it.
- The sensor-trigger form is gone. `trigger:random`, `trigger:bme680`, and `trigger:ble-tracker` are removed, along with the `samplingInterval`, `reportingInterval`, and `sampling` options they shared. A trigger into a read into `transform:accumulate` into `transform:aggregate` does the same work and says where each schedule and each aggregation lives; see [sensors.md](./sensors.md) for the replacement shape.
- `trigger:random` becomes `trigger:repeat` (or `trigger:cron`) into `read:random`, and `trigger:bme680` becomes the same into `read:bme680`.
- `trigger:ble-tracker` becomes `read:ble`, which renames `devices: [{alias, macAddress}]` to `devices: [{label, address}]`, reports each reading under `devices` rather than at the top level, and reports `rssi` as a number rather than a string. A device that was not seen is left out of the reading rather than reported at `-99`.
- There is one interpolation syntax. The `$$path` form is gone; write `${path}`. A string that is exactly one `${path}` now yields the value with its type intact rather than its stringification, which is what `$$` existed to do. A `${...}` inside longer text still splices, and a template naming something absent still reads as `undefined`.
- `transform:merge`'s `sources` take `"${stash.device}"` where they took `"$$stash.device"`. Every source is interpolated now, a literal object included, so a `${...}` inside one is resolved rather than passed through as text.
- `output:stash` stores the value's own type: `value: "${message.count}"` stashes the number `5` where it used to stash the string `"5"`. A `key` is still a string, as are topics, file paths, and shell commands.

### Added

- `cutie validate` checks a config and reports every problem, then exits non-zero if any of them is an error. `cutie start` runs the same pass and refuses to start rather than failing somewhere downstream.
- `--log-level` sets the lowest level that reaches the console.
- Per-command `--help`, and an unrecognized option is now an error that suggests the closest real one.
- `transform:convert` handles pressure and length as well as temperature, and rejects an unknown unit or a cross-dimension pair when the task registers.
- `transform:accumulate` takes a `maxAge`, so a slow topic's partial batch is passed on rather than held indefinitely, and a pending batch is flushed on shutdown instead of dropped.
- `output:mqtt` takes `retain`, `qos`, and `raw`, and `send` now awaits the publish.
- `read:file` supports `virtual` with a `virtualValue`. A read with nothing external to stand in for now rejects `virtual` rather than ignoring it.
- `read:ble` reads the Bluetooth signal strength of named devices, one sample per call, and supports `virtual`. It replaces `trigger:ble-tracker`.
- A duration option accepts a unit suffix: `interval: "5m"` alongside `interval: 300000`.

### Fixed

- Module logging reaches the console. A node running the shipped config used to print only what `output:console` wrote.
- A `trigger:logs` task feeding an output that logs no longer recurses forever.
- With two MQTT connections, a message arriving on one no longer fires triggers bound to the other.
- A node whose config topic holds no retained message now times out and falls back to its cached config instead of waiting forever.
- A `disabled` connection is no longer opened, and a step naming it is told that it is disabled rather than that it does not exist.
- Log topics name the step's real position. Every trigger, and every step of the nine modules that declared defaults, used to log under `steps.-1`.
- `trigger:repeat` and `trigger:cron` copy their configured message before each firing, so a transform that mutates it no longer writes back into the config.
- Credentials no longer reach the logs or the interpolation context: userinfo is stripped from anything that parses as a URL, and `apiKey` and `secret` join the masked keys.
- `cutie download` and `cutie upload` agree on a node's name, so downloading a fleet and uploading it again republishes each node to the topic it came from.
- `transform:round`'s `precision` and the BME sensors' `i2cAddress` accept a literal `0` instead of falling back to their defaults.
- A config that is empty, or a YAML file that does not parse, is reported with the resolved path and, for a syntax error, the line and column.
- The runtime's own log lines reach a `trigger:logs` task, under the topic `core.runtime`. The uncaught-exception line, the shutdown lines, and the connection-registration failures all used to go to the console alone, which is exactly the set of lines a node republishing its own logs most needs to send on.
- A `configProvider` naming a connection that cannot serve one is refused by name at startup, rather than throwing a generic error from a stub method partway through the fetch.
- An unrecognized `connections` entry is now an error. It used to be skipped without a word, so a typo left a task naming a connection that was never built.
