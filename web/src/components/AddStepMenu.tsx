import { useState } from "react";

import { Kind, ModuleSchema, ModuleSchemasByKind, StepConfig } from "../types";

export interface AddStepMenuProps {
  label: string;
  modules: ModuleSchemasByKind;
  kinds: ReadonlyArray<Kind>;
  onAdd: (step: StepConfig) => void;
}

function defaultsFor(schema: ModuleSchema): StepConfig {
  const step: StepConfig = { type: schema.type };

  for (const [name, option] of Object.entries(schema.options))
    if (option.default !== undefined) step[name] = option.default;

  return step;
}

export default function AddStepMenu({
  label,
  modules,
  kinds,
  onAdd,
}: AddStepMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="add-step">
      <button onClick={() => setOpen((value) => !value)}>{label}</button>

      {open && (
        <>
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9,
            }}
            onClick={() => setOpen(false)}
          />
          <div className="add-step-menu">
            {kinds.map((kind) => {
              const bySubKind = modules[kind] ?? {};
              const subKinds = Object.keys(bySubKind).sort();

              if (!subKinds.length) return null;

              return (
                <div key={kind}>
                  <h4>{kind}</h4>
                  {subKinds.map((subKind) => (
                    <button
                      key={subKind}
                      onClick={() => {
                        onAdd(defaultsFor(bySubKind[subKind]));
                        setOpen(false);
                      }}
                      title={bySubKind[subKind].description}
                    >
                      {kind}:{subKind}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
