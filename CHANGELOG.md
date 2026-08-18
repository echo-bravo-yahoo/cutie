# Changelog

## Unreleased

Every module now declares its options in a schema, and `cutie` checks a config against those schemas before it opens a socket or drives a pin. Run `cutie validate` to see everything wrong with a config at once. The full option tables are generated from the same schemas into [docs/reference](./docs/reference/README.md).

### Breaking

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

### Deprecated

- `topic` on `trigger:mqtt` and on `output:mqtt` is superseded by `topics`. A config using `topic` still works and reports one warning; naming both is an error.
- The sensor-trigger form, `trigger:random` and `trigger:ble-tracker`, is deprecated in favor of a trigger into a read into `transform:aggregate`, which separates when to sample from what to read and how to collapse the samples. See [sensors.md](./sensors.md).

### Added

- `cutie validate` checks a config and reports every problem, then exits non-zero if any of them is an error. `cutie start` runs the same pass and refuses to start rather than failing somewhere downstream.
- `--log-level` sets the lowest level that reaches the console.
- Per-command `--help`, and an unrecognized option is now an error that suggests the closest real one.
- `transform:convert` handles pressure and length as well as temperature, and rejects an unknown unit or a cross-dimension pair when the task registers.
- `transform:accumulate` takes a `maxAge`, so a slow topic's partial batch is passed on rather than held indefinitely, and a pending batch is flushed on shutdown instead of dropped.
- `output:mqtt` takes `retain`, `qos`, and `raw`, and `send` now awaits the publish.
- `read:file` supports `virtual` with a `virtualValue`. A read with nothing external to stand in for now rejects `virtual` rather than ignoring it.
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
