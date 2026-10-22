# cutie

`cutie` is a configuration-first Node.js/TypeScript runtime for MQTT-centric IoT and home-automation work: an MQTT data transform/routing layer, a small software-sensor platform for Linux boards, and an early-stage Raspberry Pi provisioner. `README.md` has the human-facing pitch; `cookbook.md`, `sensors.md`, and `examples/` hold usage recipes.

Claude-facing reference docs:

- `.claude/docs/design-principles.md` — the class hierarchy (`Configurable`/`Task`/`Step`/`Trigger`/`Transform`/`Output`/`Connection`), the linked-list step chain, interpolation syntax, and the deliberate design choices (optional hardware, virtual mode, credential redaction). Read before changing runtime internals.
- `.claude/docs/running-cutie.md` — CLI commands, the local dev loop, the full step-type inventory, provisioning a new Pi, running as a systemd service, and the retained-MQTT remote-config mechanism. Read before running, testing, or deploying cutie.

## Documentation

Never commit specifics of a real cutie installation to this repo: hostnames, wiring or pin assignments, kernel or board identifiers, deployed commit hashes, credentials, certificate IDs, or endpoints. This repo is public. Keep that kind of note in `echobravoyahoo/` (gitignored) instead.

## Build & test

- Install: `npm install` (Node 22-24; on ARMv6 use Python <=3.10.8, e.g. `PYTHON="$(which python3.10)" npm install`)
- Build: `npm run build`
- Test: `npm test` (`npm run test:watch` / `npm run test:coverage` for variants)
- Lint: `npm run lint`
- Format: `npm run prettify`
- Run: `npm start` (equivalent to `npx tsx ./src/cli-entrypoint.ts start`)

Run `npm run lint` and `npm test` before treating a change as done, and `npm run build` afterward.

## Release pipeline

`~/workspace/cutie`, `@echobravoyahoo/cutie` on npm (public). Also a Tier-C deploy target (a Raspberry Pi fleet) -- see below.

- CI: `.github/workflows/test.yaml`, triggered on push to `main`/`dev`, PRs into `main`, and `workflow_call` (so the publish workflow can gate on it). Matrix-tests the supported Node versions (listed in `test.yaml`).
- Publish: `.github/workflows/publish.yaml`, triggered on a `v*` tag push, `needs: test` via `workflow_call` so a broken build can never publish. OIDC trusted publishing, dist-tag derived from the version string (prerelease id, else `latest`), cuts a GitHub Release with `--prerelease` when the dist-tag isn't `latest`.
- Versioning: `npm version` locally on `main`, `README.md` documents the exact release steps.
- Fleet deploy (the Tier-C half): `~/.aeby/scripts/cutie-deploy.sh`, a manual SSH script over `vaxholm`/`riddarholmen`/`skeppsholmen`/`stockholm`. Deliberately outside CI -- the Pis have no public ingress, and a self-hosted Actions runner on a public repo isn't worth the added attack surface for a small hobby fleet. It derives each host's actual `npm` invocation from that host's live systemd unit instead of assuming a fleet-wide convention (each host installs node differently), never overwrites a host's hand-tuned service file, and verifies success by checking `systemctl is-active` plus grepping recent logs for known crash signatures rather than trusting "active" alone.
- Branching: work happens directly on `main`; there is no other active branch. (A stale `dev` branch existed, left over from before the OIDC publish rework -- it diverged from `main` before the rework was merged into it, and its old workflow kept re-triggering and failing on every push to it. Deleted once its one real commit, a `cutie.service` fix, was cherry-picked onto `main`.)
