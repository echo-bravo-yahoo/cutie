import { globals } from "../index.js";
import Task, { TaskConfig } from "./generic-task.js";

export async function registerTasks(tasks: Array<TaskConfig>) {
  const localLogger = globals.logger;
  localLogger.info("Registering tasks...");

  for (const [name, task] of Object.entries(tasks)) {
    const taskObject = new Task(task, name);
    await taskObject.register();
    globals.tasks.push(taskObject);

    localLogger.info({ context: task }, "Registered task.");
  }
}
