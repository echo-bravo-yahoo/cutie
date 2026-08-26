import { ConfigFile } from "./types";

// Mirrors src/web/topics.ts's knownOutputTopics on the backend (see that
// file's comment for why templated topics are excluded); duplicated rather
// than imported because this package has no dependency on the backend build.
export function knownOutputTopics(config: ConfigFile): Array<string> {
  const topics = new Set<string>();

  for (const task of Object.values(config.tasks ?? {})) {
    for (const step of task.steps ?? []) {
      if (step.type !== "output:mqtt") continue;

      const stepTopics = step.topics;
      if (!Array.isArray(stepTopics)) continue;

      for (const topic of stepTopics)
        if (typeof topic === "string" && !topic.includes("${"))
          topics.add(topic);
    }
  }

  return [...topics];
}
