import { globals } from "../index.js";
import { logAt } from "./LogHelper.js";
import Task, { TaskConfig } from "./Task.js";

const topic = "core.registration.tasks";

export async function registerTasks(tasks: Array<TaskConfig>) {
  logAt(topic, "info", "Registering tasks.");

  for (const [name, task] of Object.entries(tasks)) {
    const taskObject = new Task(task, name);
    await taskObject.register();
    globals.tasks.push(taskObject);

    logAt(topic, "info", "Registered task.", task);
  }

  return globals.tasks;
}
