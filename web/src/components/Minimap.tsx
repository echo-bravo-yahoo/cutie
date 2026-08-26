import { ConfigFile } from "../types";

export interface MinimapProps {
  config: ConfigFile | null;
  collapsedTasks: Record<string, boolean>;
  onJumpToTask: (taskName: string) => void;
  onJumpToStep: (taskName: string, stepId: string) => void;
}

export default function Minimap({
  config,
  onJumpToTask,
  onJumpToStep,
}: MinimapProps) {
  const taskNames = Object.keys(config?.tasks ?? {});

  return (
    <div className="minimap">
      {taskNames.map((taskName) => {
        const task = config!.tasks![taskName];
        const pathPrefix = `tasks.${taskName}`;
        return (
          <div className="minimap-task" key={taskName}>
            <div
              className="minimap-task-marker"
              title={`Task: ${taskName}`}
              onClick={() => onJumpToTask(taskName)}
            />
            {task.trigger && (
              <div
                className={`minimap-dot kind-${task.trigger.type.split(":")[0]}`}
                title={task.trigger.type}
                onClick={() => onJumpToStep(taskName, `${pathPrefix}.trigger`)}
              />
            )}
            {(task.steps ?? []).map((step, index) => (
              <div
                key={index}
                className={`minimap-dot kind-${step.type.split(":")[0]}`}
                title={step.type}
                onClick={() =>
                  onJumpToStep(taskName, `${pathPrefix}.steps[${index}]`)
                }
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
