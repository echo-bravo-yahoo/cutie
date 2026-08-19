import { globals } from "../index.js";
import { logAt } from "./LogHelper.js";
import Task, { TaskConfig } from "./Task.js";

const topic = "core.registration.tasks";

export async function registerTasks(tasks: Array<TaskConfig>) {
  logAt(topic, "info", "Registering tasks.");

  const declared = Object.entries(tasks);
  let registered = 0;

  for (const [name, task] of declared) {
    const taskObject = new Task(task, name);

    // Pushed before registering, as registerConnections does: a task that
    // fails partway through has already armed a trigger or opened a handle,
    // and cleanUp() can only release what it can reach.
    globals.tasks.push(taskObject);

    try {
      await taskObject.register();
    } catch (error) {
      // One task that will not register must not take every task after it
      // down, any more than one unreachable connection does.
      const reason = error instanceof Error ? error.message : error;

      logAt(
        topic,
        "error",
        `Failed to register task "${name}": ${reason}`,
        task,
      );
      continue;
    }

    registered++;
    logAt(topic, "info", "Registered task.", task);
  }

  // A config that declared tasks and registered none of them has nothing left
  // to run, so refusing beats idling as a node that does nothing.
  if (declared.length && registered === 0)
    throw new Error(
      `Refusing to start: none of the ${declared.length} tasks in the config registered.`,
    );

  return globals.tasks;
}
