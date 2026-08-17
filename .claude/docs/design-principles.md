# Design Principles

`cutie` (`README.md:5`) is configuration-first: connections, tasks, triggers, transforms, and outputs in a config file map almost verbatim onto a small runtime class hierarchy (`README.md:65-77`). This doc covers that hierarchy and the deliberate design choices behind it, so a change to runtime internals doesn't accidentally break an invariant another part of the codebase depends on.

## Core class hierarchy

- `Configurable` (`src/util/Configurable.ts:13`) — base class for every configured piece. Holds `config`, `name`, `enabled`, logging helpers (`debug`/`info`/`error`), and the `shouldEnable()`/`enable()`/`disable()` lifecycle. `Configurable.parseType` (line 87) splits a `"kind:subKind"` type string.
- `TypedConfigurable` (`src/util/TypedConfigurable.ts:11`) — adds `type`/`name` config fields and parses `kind`/`subKind` from `type`.
- `Task` (`src/util/Task.ts:20`) — one `trigger, transform, output` pipeline. `registerSteps` (line 51) dynamically imports each step's module by convention (see "Type-string to file convention" below) and links steps into a **singly linked list**: `previousStep.next = currentStep` (lines 84-88). A trigger given as a step throws (line 72) — triggers start a task, they don't sit inside one.
- `Step` (`src/util/Step.ts:22`) — abstract base for trigger/read/transform/output. `handleMessage` (line 124) walks the linked list: it calls `doHandleMessage`, and if the result is the `HALT` symbol (line 15) the chain stops silently; otherwise the message passes to `this.next`, or to `task.endMessage` at the end of the chain. Also implements interpolation (see below).
- `Trigger extends Step` (`src/util/Trigger.ts:7`) — adds `startMessage`, which kicks off `task.startMessage`, starting the chain from the first step.
- `Read extends Step` (`src/util/Read.ts:11`) — a step, not a trigger. `doHandleMessage` calls the subclass's `read()` and replaces the message with its result.
- `Output extends Step` (`src/util/Output.ts:10`) — `doHandleMessage` calls the subclass's `send()`.
- `Transform extends Step` (`src/util/Transform.ts:58`) — classifies a message (primitive/simple/composite, single-value/array/whole-message) and dispatches to `transformSingle` per the step's `path`/`paths` config, or to a whole-message `transform()` override. This shared path-walking logic is why most transforms (`round`, `convert`, `offset`, `munge`, `aggregate`) implement only `transformSingle`.
- `Sensor extends Trigger` (`src/util/Sensor.ts:19`) — for hardware/software sensors that sample on one schedule and report on another. `setupSampler`/`setupPublisher` split the two schedules; `Sensor.doAggregation` (static, lines 83-120) collapses samples via `latest`/`average`/`sum`/`median`/`pX`, with percentiles interpolated linearly to match numpy and InfluxDB's `PERCENTILE`.
- `Connection extends TypedConfigurable` (`src/util/Connection.ts:10`) — abstract base for named, reusable remote endpoints (MQTT broker, InfluxDB) that steps reference by `connectionName`.

Global runtime state lives in `globals` (`src/index.ts:20-29`): `tasks`, `connections`, `version`, `logger`, `eventBus`. `start()` (`src/index.ts:48-66`) registers connections before tasks, because tasks start immediately on registration and may need a connection to already exist (comment, line 61).

## Type-string to file convention

A config's `type` field is `"<kind>:<subKind>"` (e.g. `"trigger:mqtt"`, `"output:influxdb"`). `Task.importStep` (`src/util/Task.ts:42-49`, mirrored in `src/util/connections.ts:41-47` for connections) dynamically imports `${kind}s/${subKind}.js` relative to `src/` — so `trigger:mqtt` loads `src/triggers/mqtt.ts`, `output:influxdb` loads `src/outputs/influxdb.ts`. This convention isn't written down anywhere else; a new step type must live at the path its type string implies, or the dynamic import fails.

See `.claude/docs/running-cutie.md` for the full inventory of type strings currently implemented.

## Interpolation

Defined once on `Step` (`src/util/Step.ts:36-118`) and available to every trigger/read/transform/output.

- `generateContext()` (lines 37-47) builds the namespace: `task` (the owning task, minus its `stash`), `stash` (values a task saved via `output:stash`), `module` (the step's own config), `env` (`process.env`), `globals` (runtime globals, minus `logger`), plus whatever `additionalContext` the caller passes (almost always `{ message }`).
- `${path.to.value}` — `interpolateConfigString` (lines 50-62) matches `/\${(.*?)}/g` and resolves each match via lodash `get()` against the context above. Examples: `${env.NAME}`, `${stash.deviceId}`, `${message.filename}`, `${module.device.location}`.
- `interpolateDeep` (lines 66-84) recurses into arrays/objects, interpolating every string leaf — used for config values that are themselves objects, e.g. `trigger:once`'s `message` or `output:influxdb`'s `tags`.
- `$$path` — a distinct syntax, `interpolatePath` (lines 109-118), used only by `transform:merge`'s `sources` field (`src/transforms/merge.ts:28`) to look up a whole non-string value (e.g. an object) by path, rather than splice a string.

Interpolation runs at message-handling time on step-level config fields. It does not apply to the top-level `connections`/`configProvider` block — there's no `${env.MQTT_PASSWORD}`-style secret injection into connection credentials; those are used as literal config values.

## Design choices, and why

- **Config-driven with code escape hatches.** `README.md:5` states the intent directly. `transform:shell` and `transform:javascript` (`src/transforms/shell.ts`, `src/transforms/javascript.ts`) are the escape hatches for logic config can't express.
- **Optional hardware, graceful degradation.** Every hardware-facing package (`bme280`, `bme680-sensor`, `node-ble`, `node-switchbot`, `pigpio`, `serialport`, `thermalprinter`) is an `optionalDependency` (`package.json:58-66`), so `npm install` succeeds on a machine with no build toolchain. `importOptional` (`src/util/optional-dependency.ts:6-17`) is the mechanism: every hardware-driving step calls it lazily inside `enable()`, not at import time, so a config that never asks for that hardware never touches the package. A config that does ask for missing hardware fails at startup naming the package (`README.md:84-87`).
- **Virtual/simulated mode.** Every `read:*` sensor, plus `trigger:infrared` and `output:nec`, support `virtual: true` to fake plausible drifting values instead of touching hardware (`sensors.md:8`, drift logic in `src/util/DrunkReader.ts`). `trigger:random`/`read:random` need no hardware at all and exist specifically to develop the runtime itself (`README.md:133`).
- **Credential redaction is structural.** `src/util/redact.ts` walks a config object and blanks `password`/`username`/`token` before it reaches any log line. Every connection-registration log (`src/util/connections.ts:57`) and every freshly-fetched remote-config log (`src/connections/mqtt.ts:138`) goes through it.
- **Clean, drain-based shutdown.** `src/process.ts:19-22` disables every timer/socket/listener on `SIGTERM`/`SIGINT` and lets the event loop drain, rather than calling `process.exit()` immediately — this is also what gives the pino transport thread a chance to flush its final lines. A 2-second forced-exit watchdog is the safety net if draining hangs.
- **Fleet config over MQTT as a first-class idea, not a bolt-on.** `configProvider` (`src/util/configs.ts:12-20`) lets a node fetch its whole config from a connection at startup instead of a local file, with a local `<config>.cache.json` fallback if the remote fetch fails (`fetchConfig`, lines 28-43) — explicitly so a node keeps working through a brief broker outage. See `.claude/docs/running-cutie.md` for the operational details, and the global `~/.claude/docs/cutie-admin.md` for administering it against the live fleet.

## Known gaps

Behavior that matters but isn't written up anywhere outside code:

- The type-string-to-file convention and dynamic import (above) — a user has to infer it from example configs.
- That a `read:*` step **replaces** the message, rather than merging into it — called out only in an inline comment (`examples/interpolation.yaml:33-36`).
- The `HALT` symbol and what it means for a step to swallow a message without breaking the chain (`transform:accumulate` is the only current user) — no prose docs, only `src/util/Step.ts:15,127-129`.
- `output:logs`/`trigger:logs` wildcard-filter matching (`*`, leading `!` negates, last match wins) has a spec only in `README.md:138` and the implementation, `src/triggers/logs.ts:50-87`.
- Task-level and step-level `disabled` (cascades via `Configurable.shouldEnable`, `src/util/Configurable.ts:71-78`) is undocumented outside code.
- `output:nec`/`trigger:infrared` (IR remote control via `pigpio` bit-banging), `output:switchbots`, and `output:thermal-printer` have no cookbook recipe, example config, or `sensors.md` coverage despite being fully implemented.
- `connection:influxdb`/`output:influxdb` (line-protocol format, precision, tag interpolation) has no cookbook or example coverage either.
- `test/unit/*.ts` is a better source of ground truth for interpolation and transform edge cases than any prose doc — check there before assuming behavior.