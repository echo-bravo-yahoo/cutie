import { useState } from "react";

import {
  ConfigError,
  ConfigFile,
  ModuleSchemasByKind,
  TaskConfig,
} from "../types";
import TaskChain from "./TaskChain";

export interface TaskListProps {
  config: ConfigFile;
  modules: ModuleSchemasByKind;
  errors: Array<ConfigError>;
  structureRevision: number;
  mutate: (fn: (draft: ConfigFile) => void, structural?: boolean) => void;
  collapsedTasks: Record<string, boolean>;
  onToggleTaskCollapse: (name: string) => void;
}

const TASK_NAME_PATTERN = /^[a-z0-9-]+$/;

export default function TaskList({
  config,
  modules,
  errors,
  structureRevision,
  mutate,
  collapsedTasks,
  onToggleTaskCollapse,
}: TaskListProps) {
  const [newTaskName, setNewTaskName] = useState("");
  const taskNames = Object.keys(config.tasks ?? {});

  function addTask() {
    const name = newTaskName.trim();
    if (!TASK_NAME_PATTERN.test(name)) return;
    if (config.tasks?.[name]) return;

    mutate((draft) => {
      draft.tasks = { ...(draft.tasks ?? {}), [name]: {} };
    }, true);
    setNewTaskName("");
  }

  function removeTask(name: string) {
    mutate((draft) => {
      if (!draft.tasks) return;
      const { [name]: _removed, ...rest } = draft.tasks;
      draft.tasks = rest;
    }, true);
  }

  return (
    <div>
      <h2>Tasks</h2>

      {taskNames.length === 0 && (
        <div className="empty-state">This node declares no tasks.</div>
      )}

      {taskNames.map((name) => (
        <TaskChain
          key={name}
          taskName={name}
          task={config.tasks![name] as TaskConfig}
          config={config}
          modules={modules}
          errors={errors}
          structureRevision={structureRevision}
          onChangeTask={(updater, structural) =>
            mutate((draft) => updater(draft.tasks![name]), structural)
          }
          onRemoveTask={() => removeTask(name)}
          collapsed={!!collapsedTasks[name]}
          onToggleCollapse={() => onToggleTaskCollapse(name)}
        />
      ))}

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="new-task-name"
          value={newTaskName}
          onChange={(event) => setNewTaskName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") addTask();
          }}
        />
        <button
          onClick={addTask}
          disabled={!TASK_NAME_PATTERN.test(newTaskName.trim())}
        >
          + Add task
        </button>
      </div>
    </div>
  );
}
