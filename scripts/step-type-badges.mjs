// Single source of truth for which step types carry a "new in v4" or
// "breaking in v4" shields.io badge, and for the 1-2 sentence note a breaking
// type shows above its option table. Consumed by generate-reference.mjs for
// docs/reference/*; hand-mirrored into sensors.md and
// .claude/docs/running-cutie.md, which are not generated -- keep those in
// sync by eye when this file changes.
//
// Badges use a raw <img align="middle"> tag rather than markdown's `![]()`
// image syntax. GitHub renders a plain `![]()` image with the browser's
// default `vertical-align: baseline`, which visibly floats a shields.io
// badge above the line of text next to it (verified against GitHub's own
// markdown API); `align="middle"` fixes that and survives GitHub's HTML
// sanitizer, where a `style` attribute does not.

const NEW_BADGE =
  '<img alt="new in v4" src="https://img.shields.io/badge/new%20in%20v4-blue" align="middle">';
const BREAKING_BADGE =
  '<img alt="breaking in v4" src="https://img.shields.io/badge/breaking%20in%20v4-critical" align="middle">';

// Did not exist as any type in v3 (verified against tag 3.0.1-8).
const NEW_IN_V4 = new Set([
  "read:ble",
  "read:ltr559",
  "read:mems-mic",
  "output:inky-phat",
  "output:st7735",
  "output:unicorn-hat-mini",
  "trigger:gpio-button",
  "trigger:nec",
  "control:return",
  "control:branch",
  "control:stop",
  "control:delay",
]);

// Existed in v3; CHANGELOG.md's "### Breaking" section names a change to
// that type's own config or behavior that breaks a v3 config. The value is
// the 1-2 sentence note shown above that type's option table. A type in
// NEW_IN_V4 is never also listed here -- there is no v3 config of it to
// break, even where CHANGELOG.md separately notes a behavior change for it.
const BREAKING_IN_V4 = new Map([
  [
    "trigger:mqtt",
    "`topics` must now be an array; the old singular `topic` option is gone, with no deprecation period or alias, so a config naming `topic` is rejected with `topics` reported as the missing option.",
  ],
  [
    "trigger:infrared",
    "No longer accepts `ledPin` -- it configured an output pin the module never actually transmitted on, so the option looked load-bearing but was dead weight.",
  ],
  [
    "trigger:file-change",
    "A relative `path` now resolves against the directory holding the config file rather than the process's working directory, so a config that relied on the old cwd-relative resolution now watches a different file.",
  ],
  [
    "trigger:logs",
    "`minVerbosity` now defaults to `warn` instead of `trace`, so a logs task that wants everything has to ask for it explicitly rather than receiving every trace line by default.",
  ],
  [
    "read:random",
    "`min`, `max`, `minStep`, `maxStep`, and `start` are all now required. Omitting any one of them used to silently produce `NaN` on every reading, with nothing to signal the mistake.",
  ],
  [
    "read:file",
    "A relative `path` now resolves against the directory holding the config file rather than the process's working directory, so a config that relied on the old cwd-relative resolution now reads a different file.",
  ],
  [
    "transform:shell",
    "`outputType` is now required, closing the implicit uncoerced passthrough `transform:shell` used to fall back to; pass `any` explicitly for the same behavior.",
  ],
  [
    "transform:javascript",
    "A script is now a function body that must return its result explicitly, replacing the old completion-value semantics where a bare assignment evaluated to `undefined` and a bare `if` evaluated to whichever branch it took. It is also no longer interpolated: `${...}` inside a script is JavaScript's own template syntax now, and everything interpolation used to reach is a function parameter instead -- `message`, `stash`, `error`, `task`, `module`, `env`.",
  ],
  [
    "transform:accumulate",
    "`count` is now a required option rather than an optional one.",
  ],
  [
    "transform:uglify",
    "Rejects `spaces` rather than accepting it silently -- `transform:uglify` is `transform:prettify` with no indentation, so use `transform:prettify` with a `spaces` of `0` for the same effect, spelled explicitly.",
  ],
  [
    "transform:merge",
    "`sources` are now interpolated the same way everywhere else in a config is: `${stash.device}` replaces `$$stash.device`, and a `${...}` inside a literal object source is resolved rather than passed through as text.",
  ],
  [
    "output:mqtt",
    "`topics` must now be an array; the old singular `topic` option is gone, with no deprecation period or alias, so a config naming `topic` is rejected with `topics` reported as the missing option.",
  ],
  [
    "output:file",
    "`insertNewlines` now writes the newline after each message instead of before it, so the leading blank line goes away and the last line gains its terminator. A relative `path` also now resolves against the directory holding the config file rather than the process's working directory.",
  ],
  [
    "output:switchbots",
    "`bots: [{id, name, reverseOnOff}]` is renamed to `devices: [{address, label, reverseOnOff}]`, and the old keys are rejected rather than accepted quietly -- `name` in particular collided with the `name` every step already accepts.",
  ],
  [
    "output:thermal-printer",
    "`path` is renamed to `devicePath` and is required unless `virtual` is set, with no default of `/dev/ttyS0` any more -- `path` everywhere else in a config names a filesystem path, and this option names a serial device instead.",
  ],
  [
    "output:nec",
    "`ledPin` is now required unless `virtual` is set; the old default of `23` was a guess about someone else's wiring.",
  ],
  [
    "output:stash",
    "Writes with a path setter, so a dotted key like `device.name` nests the way `read:stash` reads it back rather than creating a literal flat key of that name. It also now stores a value's own type -- a numeric `${message.count}` stashes as a number rather than as its stringified text.",
  ],
]);

export function badgesFor(type) {
  const badges = [];
  if (NEW_IN_V4.has(type)) badges.push(NEW_BADGE);
  if (BREAKING_IN_V4.has(type)) badges.push(BREAKING_BADGE);
  return badges;
}

export function breakingNoteFor(type) {
  return BREAKING_IN_V4.get(type);
}
