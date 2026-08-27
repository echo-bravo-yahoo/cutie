import { StepConfig } from "./types";

export function kindOf(type: string): string {
  return type.split(":")[0];
}

const UNIVERSAL_FIELDS = new Set(["type", "name", "disabled", "rescue"]);

// Whatever's left on a step once the universal fields are stripped -- there
// is no module schema loaded here, so this renders raw key/value pairs
// rather than the real app's old schema-driven form fields.
export function stepOptions(step: StepConfig): Array<[string, unknown]> {
  return Object.entries(step).filter(([key]) => !UNIVERSAL_FIELDS.has(key));
}

export function isMultilineValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (isMultilineValue(value)) return JSON.stringify(value, null, 2);
  return JSON.stringify(value);
}
