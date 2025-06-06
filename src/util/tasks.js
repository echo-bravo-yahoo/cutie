import { globals } from "../index.js";
import Task from "./generic-task.js";

export async function registerTasks(tasks) {
  globals.logger.info({ role: "breadcrumb" }, "Registering tasks...");

  for (const task of Object.values(tasks)) {
    const taskObject = new Task(task);
    await taskObject.register();
    globals.tasks.push(taskObject);

    globals.logger.info(
      { role: "breadcrumb" },
      `Registered task ${JSON.stringify(task)}.`
    );
  }
}
