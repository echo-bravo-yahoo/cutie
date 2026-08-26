import { MouseEvent, useState } from "react";
import { Braces, ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";

import { ConfigError, ModuleSchema, StepConfig } from "../types";
import SchemaField from "./SchemaField";
import StepJsonEditor from "./StepJsonEditor";

export interface StepCardProps {
  step: StepConfig;
  moduleSchema: ModuleSchema | undefined;
  onChange: (next: StepConfig) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  otherTaskNames: Array<string>;
  pathPrefix: string;
  errors: Array<ConfigError>;
  // A trigger has no rescue semantics -- Trigger.abandon handles its
  // failures, not Step.recover -- so TaskChain hides this field for it.
  showRescue?: boolean;
  // ConnectionsPanel reuses this card for connections, whose "name" is the
  // required, unique identifier other steps reference, not a free label.
  nameFieldDescription?: string;
}

function errorFor(errors: Array<ConfigError>, path: string) {
  return errors.find((error) => error.path === path)?.message;
}

export default function StepCard({
  step,
  moduleSchema,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp,
  canMoveDown,
  otherTaskNames,
  pathPrefix,
  errors,
  showRescue = true,
  nameFieldDescription = "A label for this step.",
}: StepCardProps) {
  const [viewMode, setViewMode] = useState<"form" | "json">("form");
  const [collapsed, setCollapsed] = useState(false);
  const kind = step.type.split(":")[0];
  const ownErrors = errors.filter((error) => error.path.startsWith(pathPrefix));

  function set(name: string, value: unknown) {
    onChange({ ...step, [name]: value });
  }

  // Every header button sits inside the header's own click-to-collapse
  // target, so each one stops propagation before doing its own thing.
  function stopAnd(handler: () => void) {
    return (event: MouseEvent) => {
      event.stopPropagation();
      handler();
    };
  }

  return (
    <div
      className={`card${ownErrors.length ? " has-error" : ""}`}
      id={pathPrefix}
    >
      <div
        className="card-header"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="collapse-arrow">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className={`badge kind-${kind}`}>{step.type}</span>
        <span className="card-title">{step.name || ""}</span>
        <div className="card-controls">
          <button
            className="icon"
            title={viewMode === "form" ? "View as raw JSON" : "View as form"}
            aria-label={
              viewMode === "form" ? "View as raw JSON" : "View as form"
            }
            onClick={stopAnd(() =>
              setViewMode((mode) => (mode === "form" ? "json" : "form")),
            )}
          >
            <Braces size={14} />
          </button>
          {onMoveUp && (
            <button
              className="icon"
              title="Move up"
              aria-label="Move up"
              disabled={!canMoveUp}
              onClick={stopAnd(onMoveUp)}
            >
              <ChevronUp size={14} />
            </button>
          )}
          {onMoveDown && (
            <button
              className="icon"
              title="Move down"
              aria-label="Move down"
              disabled={!canMoveDown}
              onClick={stopAnd(onMoveDown)}
            >
              <ChevronDown size={14} />
            </button>
          )}
          <button
            className="icon"
            title="Remove"
            aria-label="Remove"
            onClick={stopAnd(onRemove)}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="card-body">
          {viewMode === "json" ? (
            <>
              <StepJsonEditor
                value={step}
                onChange={(next) => onChange(next as StepConfig)}
              />
              {ownErrors.length > 0 && (
                <div className="hint">
                  {ownErrors.map((error, index) => (
                    <div key={index}>{error.message}</div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <SchemaField
                id={`${pathPrefix}.name`}
                name="name"
                schema={{ type: "string", description: nameFieldDescription }}
                value={step.name}
                onChange={(value) => set("name", value)}
                error={errorFor(errors, `${pathPrefix}.name`)}
              />
              <SchemaField
                id={`${pathPrefix}.disabled`}
                name="disabled"
                schema={{
                  type: "boolean",
                  description: "Leave this step out of the task.",
                }}
                value={step.disabled}
                onChange={(value) => set("disabled", value)}
                error={errorFor(errors, `${pathPrefix}.disabled`)}
              />
              {showRescue && (
                <div className="field">
                  <label htmlFor={`${pathPrefix}.rescue`}>
                    <span>rescue</span>
                  </label>
                  <select
                    id={`${pathPrefix}.rescue`}
                    value={step.rescue ?? ""}
                    onChange={(event) =>
                      set("rescue", event.target.value || undefined)
                    }
                  >
                    <option value="">(default: this task's own rescue)</option>
                    {otherTaskNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Which task to run when this step fails.
                  </span>
                  {errorFor(errors, `${pathPrefix}.rescue`) && (
                    <span className="field-error-message">
                      {errorFor(errors, `${pathPrefix}.rescue`)}
                    </span>
                  )}
                </div>
              )}

              {moduleSchema === undefined && (
                <span className="hint">
                  Unknown module type "{step.type}" -- showing only universal
                  fields.
                </span>
              )}

              {moduleSchema &&
                Object.entries(moduleSchema.options).map(
                  ([name, optionSchema]) => (
                    <SchemaField
                      key={name}
                      id={`${pathPrefix}.${name}`}
                      name={name}
                      schema={optionSchema}
                      value={step[name]}
                      onChange={(value) => set(name, value)}
                      error={errorFor(errors, `${pathPrefix}.${name}`)}
                    />
                  ),
                )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
