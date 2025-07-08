import { globals } from "../index.js";
import Task, { TaskConfig } from "./Task.js";

export async function registerTasks(tasks: Array<TaskConfig>) {
  globals.logger.emit(
    "Registering tasks.",
    "info",
    "[core.registration.tasks]",
  );

  for (const [name, task] of Object.entries(tasks)) {
    const taskObject = new Task(task, name);
    await taskObject.register();
    globals.tasks.push(taskObject);

    globals.logger.emit(
      "Registered step.",
      "info",
      "[core.registration.tasks]",
      task,
    );
  }
}
