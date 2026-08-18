# cutie

`cutie` is a configuration-first Node.js/TypeScript runtime for MQTT-centric IoT and home-automation work: an MQTT data transform/routing layer, a small software-sensor platform for Linux boards, and an early-stage Raspberry Pi provisioner. `README.md` has the human-facing pitch; `cookbook.md`, `sensors.md`, and `examples/` hold usage recipes.

Claude-facing reference docs:

- `.claude/docs/design-principles.md` — the class hierarchy (`Configurable`/`Task`/`Step`/`Trigger`/`Transform`/`Output`/`Connection`), the linked-list step chain, interpolation syntax, and the deliberate design choices (optional hardware, virtual mode, credential redaction). Read before changing runtime internals.
- `.claude/docs/running-cutie.md` — CLI commands, the local dev loop, the full step-type inventory, provisioning a new Pi, running as a systemd service, and the retained-MQTT remote-config mechanism. Read before running, testing, or deploying cutie.

## Build & test

- Install: `npm install` (Node 22-24; on ARMv6 use Python <=3.10.8, e.g. `PYTHON="$(which python3.10)" npm install`)
- Build: `npm run build`
- Test: `npm test` (`npm run test:watch` / `npm run test:coverage` for variants)
- Lint: `npm run lint`
- Format: `npm run prettify`
- Run: `npm start` (equivalent to `npx tsx ./src/cli-entrypoint.ts start`)

Run `npm run lint` and `npm test` before treating a change as done, and `npm run build` afterward.
