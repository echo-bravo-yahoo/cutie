// Single source of truth for which step types carry a "new in v4" or
// "breaking in v4" shields.io badge. Consumed by generate-reference.mjs for
// docs/reference/*; hand-mirrored into sensors.md and
// .claude/docs/running-cutie.md, which are not generated -- keep those in
// sync by eye when this file changes.

const NEW_BADGE =
  "![new in v4](https://img.shields.io/badge/new%20in%20v4-blue)";
const BREAKING_BADGE =
  "![breaking in v4](https://img.shields.io/badge/breaking%20in%20v4-critical)";

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

// Existed in v3; CHANGELOG.md's "### Breaking" section names a config or
// behavior change to this specific type that breaks a v3 config. A type in
// NEW_IN_V4 is never also listed here -- there is no v3 config of it to
// break, even where CHANGELOG.md separately notes a behavior change for it.
const BREAKING_IN_V4 = new Set([
  "trigger:mqtt",
  "trigger:infrared",
  "trigger:file-change",
  "trigger:logs",
  "read:random",
  "read:file",
  "transform:shell",
  "transform:javascript",
  "transform:accumulate",
  "transform:uglify",
  "transform:merge",
  "output:mqtt",
  "output:file",
  "output:switchbots",
  "output:thermal-printer",
  "output:nec",
  "output:stash",
]);

export function badgesFor(type) {
  const badges = [];
  if (NEW_IN_V4.has(type)) badges.push(NEW_BADGE);
  if (BREAKING_IN_V4.has(type)) badges.push(BREAKING_BADGE);
  return badges;
}
