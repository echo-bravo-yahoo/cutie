import { globals } from "../index.js";
import { Configurable } from "./Configurable.js";
import Task, { TaskConfig } from "./Task.js";

const topic = "core.registration.tasks";

export async function registerTasks(tasks: Array<TaskConfig>) {
  globals.logger.emit(
    Configurable.formatLogLine("Registering tasks.", { topic }),
    "info",
    topic,
  );

  for (const [name, task] of Object.entries(tasks)) {
    const taskObject = new Task(task, name);
    await taskObject.register();
    globals.tasks.push(taskObject);

    globals.logger.emit(
      Configurable.formatLogLine("Registered task.", { topic }),
      "info",
      topic,
      task,
    );
  }
}
