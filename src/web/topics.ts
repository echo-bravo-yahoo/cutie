import type { MQTTConfig } from "../outputs/mqtt.js";
import { ConfigFile } from "../util/configs.js";

// A templated topic ("${...}") cannot be resolved without a live message, so
// it is reported as unresolvable rather than included as if it were literal.
function isResolvable(topic: string): boolean {
  return !topic.includes("${");
}

// Every literal output:mqtt topic a node's config publishes to, scanned
// statically rather than observed live. Used to default the live message feed
// to "this node's own traffic" instead of the whole broker's firehose.
export function knownOutputTopics(config: ConfigFile): Array<string> {
  const topics = new Set<string>();

  // config.tasks is a Record<name, TaskConfig> at runtime -- see
  // src/util/validate.ts's declaredTaskNames -- despite ConfigFile's own
  // `Array<TaskConfig>` annotation in src/util/configs.ts; Object.values
  // works the same either way, so this does not need to take a side.
  for (const task of Object.values(config.tasks ?? [])) {
    for (const step of task.steps ?? []) {
      if (step.type !== "output:mqtt") continue;

      for (const topic of (step as unknown as MQTTConfig).topics ?? [])
        if (isResolvable(topic)) topics.add(topic);
    }
  }

  return [...topics];
}
