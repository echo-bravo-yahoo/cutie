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
- Every step accepts `disabled`, `name`, and `rescue`, and they are now type-checked like any other option. A `disabled: "maybe"` that used to be read as truthy and quietly turn a step off is rejected instead.
- `read:mems-mic` throws when a capture fails rather than halting the message. Containing a failure is the runtime's job now: the trigger keeps the node up, and a `rescue` decides what a skipped reading becomes.
- `output:inky-phat` and `output:st7735` no longer swallow a failed draw. The chain sees the failure, which is what makes it routable; a `rescue` whose only step is a bare `control:return` restores the old behaviour of carrying on with the same message.
- `read:mems-mic` aside, `Read.read` no longer returns `HALT`. `HALT` means "deliberately consumed", which is what `transform:accumulate` uses it for, and no longer doubles as "my read failed".
- A `transform:javascript` script is a function body and has to `return` its result. `command: "21 * 2"` becomes `command: "return 21 * 2"`. The completion-value rule it replaces was a genuinely surprising one -- `const a = 1` evaluates to `undefined`, and a bare `if` evaluates to whichever branch it took -- and a `return` is what anyone reading the config expects.
- A `transform:javascript` script is no longer interpolated. `${...}` in one is JavaScript's own template syntax now, so a template literal reaches the VM intact. Everything the interpolation reached is a parameter of the compiled function instead: `message`, `stash`, `error`, `task`, `module`, and `env`. A script that read `${stash.device}` reads `stash.device`.
- `globals` is not among them, so a script cannot reach `${globals.version}` or the connection list any more. It needs a `redact()` pass per message, which nothing was asking for from JavaScript.
- A `transform:javascript` `codePath` is read once, when the task registers, rather than on every message. Editing the script file needs a restart to take effect, and a script that cannot be read or cannot be parsed now fails its task at registration instead of failing every message.

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
- `rescue` names the task to run when a step fails. Put it on a step, or on a task as the default for all of its steps. The rescue is handed the message that failed and an `${error...}` namespace -- `${error.message}`, `${error.name}`, `${error.task}`, `${error.step}`, `${error.type}` -- and works on a deep copy of the failing message's stash. `cutie validate` refuses a rescue naming a task the config does not declare, and one that leads back to the task it rescues.
- `control:` is a fifth kind of module: a step that decides what the chain does next rather than changing the message. `control:return` is the first, and hands a value back to whatever invoked its task; a task that falls off its own end returns nothing.
- `trigger:logs` takes a `maxVerbosity`, the ceiling to pair with `minVerbosity`'s floor. Without it an error lands in the ordinary log task as well as any alert task, so "send errors somewhere else" was not expressible.
- Every log line the node writes before any `trigger:logs` task is listening is held and replayed to each one as it registers. Connections register before tasks, so an unreachable broker -- the likeliest first failure on a fresh node -- could not previously be routed anywhere at all.
- Modules can log at `warn`. The three places that warned used to reach past their own topic to the runtime logger, so a topic-scoped filter could not see them.

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
- A step that throws no longer takes the node down and every other task with it. The step logs the failure under its own topic, at `error`, with the message's trace ID and a structured object naming the task, the step, the module type, and the error; the trigger then abandons the message and the task carries on. A trigger that builds its message inside its own timer callback is guarded too, where guarding the promise alone would not have reached it.
- A rejection nothing caught is reported as one, with its reason, rather than arriving as a bare uncaught exception.
- One task that fails to register no longer aborts every task after it. It is reported under `core.registration.tasks` and skipped, matching what connections already did; a config whose every task fails still refuses to start. A partially registered task is now reachable by the shutdown path, and a task enables its steps before arming its trigger, so a failure cannot leave a live trigger over a half-enabled chain.
- The line explaining why the node is stopping now reaches a `trigger:logs` task. Shutdown disabled every listener before the fan-out had run, which is exactly when the node most needs to send that line on.
- `read:mems-mic` removes its capture file whether or not the capture succeeded.
- A publish dropped because its connection never connected is logged at `warn` rather than `debug`, and a GPIO base that cannot be read from sysfs is reported rather than silently guessed at `0`.
- `transform:javascript` costs 0.04us a message rather than 341us. It used to stand up a fresh V8 realm and recompile its source for every message, because interpolating the source first meant the text could differ each time; the source is fixed now, so it is compiled once when the task registers and only called per message.
- A node whose retained config message arrives before its own subscribe request's round trip finishes is no longer missed. `fetchConfig`/`fetchSingleConfig` used to attach their message listener after awaiting the subscribe, so a fast broker reply raced past it and the fetch waited out the full timeout before falling back to a stale cache.
- `transform:shell`'s `command`/`codePath` interpolation resolves a dotted path into the message, such as `${message.temp}`, instead of silently splicing in the literal text `undefined`. It used to stringify the whole message to JSON before interpolating, which broke any path narrower than `${message}` itself. Splicing a non-string value anywhere `${...}` interpolation runs now produces its JSON text rather than `[object Object]`.
