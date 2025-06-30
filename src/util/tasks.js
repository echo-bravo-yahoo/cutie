import { globals } from "../index.js";
import Task from "./generic-task.js";

export async function registerTasks(tasks) {
  const localLogger = globals.logger.child(
    {},
    {
      msgPrefix: "[core.registration.tasks] ",
    }
  );
  localLogger.info("Registering tasks...");

  for (const task of Object.values(tasks)) {
    const taskObject = new Task(task);
    await taskObject.register();
    globals.tasks.push(taskObject);

    localLogger.info({ context: task }, "Registered task.");
  }
}
