import { ConfigFile } from "./types";

export interface Backlink {
  fromTask: string;
  // What kind of reference this is, for the label shown next to it.
  via: "rescue" | "branch";
}

// Every place another task in the same config can name this one: a task-level
// rescue, a step-level rescue, or a control:branch step's target. Pure and
// client-side -- the fleet's whole config is already loaded, so no backend
// endpoint is needed to answer "what invokes this task?".
export function invokersOf(
  taskName: string,
  config: ConfigFile,
): Array<Backlink> {
  const backlinks: Array<Backlink> = [];

  for (const [otherName, task] of Object.entries(config.tasks ?? {})) {
    if (otherName === taskName) continue;

    if (task.rescue === taskName)
      backlinks.push({ fromTask: otherName, via: "rescue" });

    for (const step of task.steps ?? []) {
      if (step.rescue === taskName)
        backlinks.push({ fromTask: otherName, via: "rescue" });

      if (step.type === "control:branch" && step.task === taskName)
        backlinks.push({ fromTask: otherName, via: "branch" });
    }
  }

  return backlinks;
}
