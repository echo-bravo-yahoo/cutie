# Design Principles

`cutie` (`README.md:5`) is configuration-first: connections, tasks, triggers, transforms, and outputs in a config file map almost verbatim onto a small runtime class hierarchy (`README.md:114-125`). This doc covers that hierarchy and the deliberate design choices behind it, so a change to runtime internals doesn't accidentally break an invariant another part of the codebase depends on.

## Core class hierarchy

```text
Configurable                    config, logging, the enable/disable lifecycle
├── Task                        the only Configurable with no `type`
└── Module                      declared by a `type: "kind:subKind"` entry, so it has a schema
    ├── Connection              owned by the runtime
    └── TaskModule              owned by a task; interpolation lives here
        ├── Trigger             starts a message
        └── Step                sits in the chain
            ├── Read
            ├── Transform
            └── Output
```

- `Configurable` (`src/util/Configurable.ts:38`) — base class for every configured piece. Holds `config`, `name`, `enabled`, `logPrefix`, the logging helpers (`debug`/`info`/`error`, lines 50-68), and the `shouldEnable()`/`enable()`/`disable()` lifecycle. `shouldEnable` (lines 79-81) is only `!this.config.disabled`. `Configurable.parseType` (line 90) splits a `"kind:subKind"` type string.
- `Task` (`src/util/Task.ts:21`) — one `trigger, transform, output` pipeline, and the only `Configurable` that is not a `Module`, because a task is named by its key under `tasks:` rather than by a `type`. `registerSteps` (line 52) dynamically imports each step's module by convention (see "Type-string to file convention" below) and links the enabled steps into a **singly linked list**: `previousStep.next = currentStep` (lines 80-84). A trigger given as a step throws (line 68) — triggers start a task, they don't sit inside one.
- `Module` (`src/util/Module.ts:13`) — everything a config names with a `type`, and so everything with a schema behind it. Parses `kind` and `subKind` out of the type string; its config interface is `ModuleConfig` (lines 4-9).
- `Connection extends Module` (`src/util/Connection.ts:53`) — a named, reusable remote endpoint (MQTT broker, InfluxDB) that steps reference by `connectionName`. The runtime owns it, not any one task. Serving a fleet's configs is a separate `ConfigProvider` interface (lines 13-27) that only `MQTTConnection` implements, and `requireConfigProvider` (lines 42-51) names the connection when a config asks a non-provider to serve one.
- `TaskModule extends Module` (`src/util/TaskModule.ts:101`) — a module a task owns rather than the runtime. It carries the whole message-shaped surface: interpolation (see below), the code-source helpers `generateCode`/`requireOneCodeSource`, the config-path helpers `resolveConfigPath`/`configDir`, `cloneMessage`, and the `AsyncLocalStorage` store (line 60) that follows one message's stash and current value through every await. `shouldEnable` (lines 120-122) also consults the owning task's `disabled`, so disabling a task stops its trigger firing rather than merely emptying its chain.
- `Trigger extends TaskModule` (`src/util/Trigger.ts:9`) — adds `startMessage`, which kicks off `task.startMessage`, starting the chain from the first step. A trigger is not a `Step`: it has no `next` and no `handleMessage`, and both `Task.registerSteps` and the validator reject one in a step slot.
- `Step extends TaskModule` (`src/util/Step.ts:31`) — a task module that sits in the chain, and nothing beyond that: `next`, `handleMessage`, `doHandleMessage`, `endMessage`, and `HALT`. `handleMessage` (lines 39-70) walks the linked list: it calls `doHandleMessage`, and if the result is the `HALT` symbol (line 27) the chain stops silently (line 60); otherwise the message passes to `this.next`, or to `task.endMessage` at the end of the chain. The helpers that live on `TaskModule` are re-exported here (lines 11-21), so no importing module's import list had to change.
- `Read extends Step` (`src/util/Read.ts:10`) — a step, not a trigger. `doHandleMessage` (line 39) calls the subclass's `read()` and replaces the message with its result.
- `Output extends Step` (`src/util/Output.ts:10`) — `doHandleMessage` (line 20) calls the subclass's `send()` and then hands on the message it was given, which makes an output module's return value dead.
- `Transform extends Step` (`src/util/Transform.ts:108`) — classifies a message and dispatches to `transformSingle` per the step's `path`/`paths` config. `transform()` (lines 202-277) picks `transformOne` (line 318) for the whole message or the one value `path` names, or `transformEach` (line 329) for a `paths` map, and wraps either in `walkArray` (line 305) when the message holds an array of readings. `walksArrays` (line 117) decides whether an array at the target is a list to map over, which is the default, or data to collapse whole; `transform:aggregate` is the one that sets it false. `honorsTargeting` (line 114) is set false by a transform that drives the whole message itself, and registration then rejects the targeting options outright. This shared path-walking logic is why most transforms (`round`, `convert`, `offset`, `munge`, `aggregate`) implement only `transformSingle`.

Sampling on one schedule and reporting on another is a task shape rather than a class: `trigger:cron` or `trigger:repeat`, then a `read:*`, then `transform:accumulate` to gather a batch and `transform:aggregate` to collapse it (`sensors.md:3-7,102-129`). The percentile math is a free function, `doAggregation` (`src/util/aggregation.ts:11-52`), which collapses samples via `latest`/`average`/`sum`/`median`/`pX`, with percentiles interpolated linearly to match numpy and InfluxDB's `PERCENTILE`.

Global runtime state lives in `globals` (`src/util/globals.ts:7-19`): `tasks`, `connections`, `version`, `logger`, `eventBus`, and `configDir`. It sits in its own leaf module because the class hierarchy needs it, and importing `src/index.ts` from mid-hierarchy re-enters that hierarchy before its base classes are defined; `src/index.ts` re-exports it (line 23) so `import { globals } from "../index.js"` still resolves. `start()` (`src/index.ts:42-70`) registers connections before tasks, because tasks start immediately on registration and may need a connection to already exist (comment, lines 64-65).

Logging follows the same ownership. `LogLineOptions.topic` (`src/util/Configurable.ts:21-26`) is optional and defaults to the instance's own `logPrefix`, so `this.debug("Handled message.", { traceId })` is the normal form and a module never names its own topic. Code that is not a `Configurable` logs through the free `logAt(topic, verbosity, message, object?)` (`src/util/LogHelper.ts:18-30`), and `LogHelper`'s own `info`/`error`/`debug`/`warn`/`trace`/`fatal` (lines 79-101) route through `emit` under the `core.runtime` topic, so a runtime line reaches a `trigger:logs` task the same way a module's line does.

## Type-string to file convention

A config's `type` field is `"<kind>:<subKind>"` (e.g. `"trigger:mqtt"`, `"output:influxdb"`). `Task.importStep` (`src/util/Task.ts:41-50`, mirrored in `src/util/connections.ts:28-30` for connections) dynamically imports `${kind}s/${subKind}.js` relative to `src/` — so `trigger:mqtt` loads `src/triggers/mqtt.ts`, `output:influxdb` loads `src/outputs/influxdb.ts`. The filesystem is the registry: `listModules` (`src/util/modules.ts:33-43`) reads those five directories, nothing hard-codes a module list, and every file in one of them is therefore taken to be a module and has to declare a schema. Shared data and helpers belong under `src/util/`.

See `.claude/docs/running-cutie.md` for the full inventory of type strings currently implemented.

## Interpolation

Defined once on `TaskModule` (`src/util/TaskModule.ts:124-210`) and available to every trigger, read, transform, and output. A `Connection` is a `Module` but not a `TaskModule`, so it has no interpolation methods at all.

- `generateContext()` (lines 127-158) builds the namespace: `task` (the owning task), `stash` (values this message saved via `output:stash`), `module` (the module's own config), `env` (`process.env`), `globals` (runtime globals, minus `logger`, with each connection projected to a redacted plain object), plus whatever `additionalContext` the caller passes. `message` comes from the `AsyncLocalStorage` store, and falls back to `NO_MESSAGE` (line 18) when a trigger interpolates before any message exists.
- `${path.to.value}` is the only syntax. `interpolateConfigString` (lines 161-173) matches `/\${(.*?)}/g` and resolves each match via lodash `get()` against the context above. Examples: `${env.NAME}`, `${stash.deviceId}`, `${message.filename}`, `${module.device.location}`.
- `interpolateDeep` (lines 182-210) recurses into arrays and objects, interpolating every string leaf — used for config values that are themselves objects, e.g. `trigger:once`'s `message`, `output:influxdb`'s `tags`, and `transform:merge`'s `sources`. A string that is exactly one `${path}` — `WHOLE_TEMPLATE`, line 22 — yields the resolved value with its type intact, which is how a source can be an object or a number rather than its stringification; a `${...}` inside a longer string splices as text. A path that resolves to nothing falls through to the splice, so a template naming something absent reads the same either way.

Interpolation runs at message-handling time on module-level config fields. It does not apply to the top-level `connections`/`configProvider` block — there's no `${env.MQTT_PASSWORD}`-style secret injection into connection credentials; those are used as literal config values.

## Design choices, and why

- **Config-driven with code escape hatches.** `README.md:5` states the intent directly. `transform:shell` and `transform:javascript` (`src/transforms/shell.ts`, `src/transforms/javascript.ts`) are the escape hatches for logic config can't express.
- **Optional hardware, graceful degradation.** Every hardware-facing package (`bme280`, `bme680-sensor`, `inkyphat`, `node-ble`, `node-switchbot`, `onoff`, `pi-spi`, `pigpio`, `serialport`, `thermalprinter`) is an `optionalDependency` (`package.json:65-76`), so `npm install` succeeds on a machine with no build toolchain. `importOptional` (`src/util/optional-dependency.ts:6-17`) is the mechanism: every hardware-driving module calls it lazily inside `enable()`, not at import time, so a config that never asks for that hardware never touches the package. A config that does ask for missing hardware fails at startup naming the package (`README.md:131-136`).
- **Virtual/simulated mode.** Every module that drives something external takes `virtual: true` and stands in for it instead of touching it: a read fakes plausible drifting values (drift logic in `src/util/DrunkReader.ts`), and a display still loads, scales, and quantises its source before logging what it would have drawn (`sensors.md:23-25`). It is not universal, and a read with nothing external to stand in for rejects `virtual` at registration rather than ignoring it (`src/util/Read.ts:32-37`). `read:random` is the one that needs no hardware at all — every reading it produces is already synthetic, which makes it the way to exercise the runtime itself on a development box (`README.md:201`).
- **Credential redaction is structural.** `src/util/redact.ts` walks a config object and blanks `password`/`username`/`token`/`apiKey`/`secret`, and strips the userinfo out of any value that parses as a URL, before it reaches any log line. Every connection-registration log (`src/util/connections.ts:67`) and every freshly-fetched remote-config log (`src/connections/mqtt.ts:172-175`) goes through it.
- **Clean, drain-based shutdown.** `src/process.ts:19-22` disables every timer/socket/listener on `SIGTERM`/`SIGINT` and lets the event loop drain, rather than calling `process.exit()` immediately — this is also what gives the pino transport thread a chance to flush its final lines. A 2-second forced-exit watchdog is the safety net if draining hangs.
- **Fleet config over MQTT as a first-class idea, not a bolt-on.** `configProvider` (`src/util/configs.ts:12-20`) lets a node fetch its whole config from a connection at startup instead of a local file, with a local `<config>.cache.json` fallback if the remote fetch fails (`fetchConfig`, lines 46-69) — explicitly so a node keeps working through a brief broker outage. See `.claude/docs/running-cutie.md` for the operational details, and the global `~/.claude/docs/cutie-admin.md` for administering it against the live fleet.

## Known gaps

Behavior that matters but isn't written up anywhere outside code:

- The type-string-to-file convention and dynamic import (above) — a user has to infer it from example configs.
- That a `read:*` step **replaces** the message, rather than merging into it — called out only in an inline comment (`examples/interpolation.yaml:34-38`).
- The `HALT` symbol and what it means for a step to swallow a message without breaking the chain (`transform:accumulate` is the only current user) — no prose docs, only `src/util/Step.ts:25-27,59-60`.
- `output:logs`/`trigger:logs` wildcard-filter matching (`*`, leading `!` negates, last match wins) has a spec only in `README.md:211` and the implementation, `src/triggers/logs.ts:46-111`.
- Task-level and step-level `disabled` (`Configurable.shouldEnable`, `src/util/Configurable.ts:79-81`, widened to the owning task by `src/util/TaskModule.ts:120-122`) is undocumented outside code.
- `output:nec`/`trigger:infrared` (IR remote control via `pigpio` bit-banging), `output:switchbots`, and `output:thermal-printer` have no cookbook recipe or example config despite being fully implemented.
- `connection:influxdb`/`output:influxdb` (line-protocol format, precision, tag interpolation) has no cookbook or example coverage either.
- `test/unit/*.ts` is a better source of ground truth for interpolation and transform edge cases than any prose doc — check there before assuming behavior.
