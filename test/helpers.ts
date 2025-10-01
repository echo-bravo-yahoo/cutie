import { Globals } from "../src";
import Task from "../src/util/Task";

export const mockTask = {
  config: { steps: [] },
} as unknown as Task;

export const mockGlobals = {
  name: "island",
  deeply: { nested: "metadata" },
} as unknown as Globals;

interface TaskDoneOptions {
  timeout: number;
  waitFor: number;
}

export function taskDone(
  task: Task,
  incomingOptions?: Partial<TaskDoneOptions>,
) {
  const options: TaskDoneOptions = {
    timeout: 10,
    waitFor: 1,
    ...incomingOptions,
  };

  return new Promise<void>((resolve, reject) => {
    setTimeout(() => reject(), options.timeout);
    const interval = setInterval(() => {
      if (task.messagesHandled >= options.waitFor) {
        resolve();
        clearInterval(interval);
      }
    }, 1);
  });
}
