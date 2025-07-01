import { globals } from "../index.js";
import { Globals } from "./generic-loggable.js";
import Task, { TaskConfig } from "./generic-task.js";

export async function registerTasks(tasks: Array<TaskConfig>) {
  const localLogger = (globals as Globals).logger.child(
    {},
    {
      msgPrefix: "[core.registration.tasks] ",
    }
  );
  localLogger.info("Registering tasks...");

  for (const task of Object.values(tasks)) {
    const taskObject = new Task(task);
    await taskObject.register();
    (globals as Globals).tasks.push(taskObject);

    localLogger.info({ context: task }, "Registered task.");
  }
}
