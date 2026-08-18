export const DURATION_UNITS = ["ms", "s", "m", "h"] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number];

const IN_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

// A duration is either a bare number in the option's own documented unit, or a
// string carrying an explicit unit. A numeric string is rejected rather than
// guessed at, because "5" reads as five of something the config never says.
// Always returns milliseconds.
export function parseDuration(
  value: unknown,
  optionName: string,
  bareUnit: DurationUnit = "ms",
): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(
        `"${optionName}" should be a duration of zero or more ${bareUnit}, but found ${value}.`,
      );

    return value * IN_MS[bareUnit];
  }

  if (typeof value === "string") {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);

    if (!match)
      throw new Error(
        `"${optionName}" should be a number of ${bareUnit} or a duration with an explicit unit such as "250ms", "2s", "5m", or "1h", but found "${value}".`,
      );

    return Number(match[1]) * IN_MS[match[2] as DurationUnit];
  }

  throw new Error(
    `"${optionName}" should be a number or a duration string, but found ${value === null ? "null" : typeof value}.`,
  );
}
