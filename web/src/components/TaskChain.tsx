import { invokersOf } from "../backlinks";
import {
  ConfigError,
  ConfigFile,
  ModuleSchemasByKind,
  StepConfig,
  TaskConfig,
  moduleSchemaFor,
} from "../types";
import AddStepMenu from "./AddStepMenu";
import CollapsibleSection from "./CollapsibleSection";
import SchemaField from "./SchemaField";
import StepCard from "./StepCard";

export interface TaskChainProps {
  taskName: string;
  task: TaskConfig;
  config: ConfigFile;
  modules: ModuleSchemasByKind;
  errors: Array<ConfigError>;
  structureRevision: number;
  // `structural` bumps structureRevision one level up, forcing every StepCard
  // in this task to remount so a JSON-editing textarea's local buffer never
  // shows stale content after its step moved to a different array index.
  onChangeTask: (
    updater: (task: TaskConfig) => void,
    structural?: boolean,
  ) => void;
  onRemoveTask: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function TaskChain({
  taskName,
  task,
  config,
  modules,
  errors,
  structureRevision,
  onChangeTask,
  onRemoveTask,
  collapsed,
  onToggleCollapse,
}: TaskChainProps) {
  const otherTaskNames = Object.keys(config.tasks ?? {}).filter(
    (name) => name !== taskName,
  );
  const backlinks = invokersOf(taskName, config);
  const steps = task.steps ?? [];
  const pathPrefix = `tasks.${taskName}`;

  function setStep(index: number, next: StepConfig) {
    onChangeTask((draft) => {
      draft.steps![index] = next;
    });
  }

  function moveStep(index: number, offset: number) {
    onChangeTask((draft) => {
      const list = draft.steps!;
      const target = index + offset;
      [list[index], list[target]] = [list[target], list[index]];
    }, true);
  }

  function removeStep(index: number) {
    onChangeTask((draft) => {
      draft.steps!.splice(index, 1);
    }, true);
  }

  function addStep(step: StepConfig) {
    onChangeTask((draft) => {
      draft.steps = [...(draft.steps ?? []), step];
    }, true);
  }

  return (
    <CollapsibleSection
      id={pathPrefix}
      label="Task:"
      title={taskName}
      monospaceTitle
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      onRemove={onRemoveTask}
      extra={
        backlinks.length > 0 && (
          <div className="backlinks">
            Invoked by:{" "}
            {backlinks
              .map((link) => `${link.fromTask} (${link.via})`)
              .join(", ")}
          </div>
        )
      }
    >
      <SchemaField
        id={`${pathPrefix}.rescue`}
        name="rescue"
        schema={{
          type: "string",
          description:
            "Default rescue for every step in this task that does not name its own.",
        }}
        value={task.rescue}
        onChange={(value) =>
          onChangeTask((draft) => {
            draft.rescue = (value as string) || undefined;
          })
        }
        error={
          errors.find((error) => error.path === `${pathPrefix}.rescue`)?.message
        }
      />

      {task.trigger ? (
        <StepCard
          key={`trigger-${structureRevision}`}
          step={task.trigger}
          moduleSchema={moduleSchemaFor(modules, task.trigger.type)}
          onChange={(next) =>
            onChangeTask((draft) => {
              draft.trigger = next;
            })
          }
          onRemove={() =>
            onChangeTask((draft) => {
              draft.trigger = undefined;
            }, true)
          }
          canMoveUp={false}
          canMoveDown={false}
          otherTaskNames={otherTaskNames}
          pathPrefix={`${pathPrefix}.trigger`}
          errors={errors}
          showRescue={false}
        />
      ) : (
        <AddStepMenu
          label="+ Set trigger"
          modules={modules}
          kinds={["trigger"]}
          onAdd={(step) =>
            onChangeTask((draft) => {
              draft.trigger = step;
            }, true)
          }
        />
      )}

      <div style={{ marginTop: 10 }}>
        {steps.map((step, index) => (
          <StepCard
            key={`${index}-${structureRevision}`}
            step={step}
            moduleSchema={moduleSchemaFor(modules, step.type)}
            onChange={(next) => setStep(index, next)}
            onMoveUp={() => moveStep(index, -1)}
            onMoveDown={() => moveStep(index, 1)}
            onRemove={() => removeStep(index)}
            canMoveUp={index > 0}
            canMoveDown={index < steps.length - 1}
            otherTaskNames={otherTaskNames}
            pathPrefix={`${pathPrefix}.steps[${index}]`}
            errors={errors}
          />
        ))}

        <AddStepMenu
          label="+ Add step"
          modules={modules}
          kinds={["read", "transform", "control", "output"]}
          onAdd={addStep}
        />
      </div>
    </CollapsibleSection>
  );
}
