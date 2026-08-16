import { randomBytes } from "node:crypto";

import { v7 as uuidV7 } from "uuid";

export function newTraceId() {
  return uuidV7();
}

// A uuid v7 with its dashes stripped is exactly the 32 lowercase hex
// characters W3C wants for a trace-id. The parent-id field has no counterpart
// in cutie, which has no span concept, so every publish gets a random one.
export function toTraceparent(traceId: string) {
  return `00-${traceId.replace(/-/g, "")}-${randomBytes(8).toString("hex")}-01`;
}

export function fromTraceparent(header: string) {
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(header);
  // an all-zero trace-id is invalid per the spec
  if (!match || /^0+$/.test(match[1])) return undefined;

  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
