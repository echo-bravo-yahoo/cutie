import { useState } from "react";

import {
  ConfigError,
  ConfigFile,
  ConnectionConfig,
  ModuleSchemasByKind,
  StepConfig,
  moduleSchemaFor,
} from "../types";
import AddStepMenu from "./AddStepMenu";
import CollapsibleSection from "./CollapsibleSection";
import StepCard from "./StepCard";

export interface ConnectionsPanelProps {
  config: ConfigFile;
  modules: ModuleSchemasByKind;
  errors: Array<ConfigError>;
  structureRevision: number;
  mutate: (fn: (draft: ConfigFile) => void, structural?: boolean) => void;
}

export default function ConnectionsPanel({
  config,
  modules,
  errors,
  structureRevision,
  mutate,
}: ConnectionsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const connections = config.connections ?? [];

  // StepCard hands back a StepConfig-shaped object (a `name` may be
  // temporarily blank while the operator is still typing it in); the
  // validator, not the type system, is what enforces a connection's `name` is
  // present before publish.
  function setConnection(index: number, next: StepConfig) {
    mutate((draft) => {
      draft.connections[index] = next as unknown as ConnectionConfig;
    });
  }

  function moveConnection(index: number, offset: number) {
    mutate((draft) => {
      const target = index + offset;
      [draft.connections[index], draft.connections[target]] = [
        draft.connections[target],
        draft.connections[index],
      ];
    }, true);
  }

  function removeConnection(index: number) {
    mutate((draft) => {
      draft.connections.splice(index, 1);
    }, true);
  }

  function addConnection(step: StepConfig) {
    mutate((draft) => {
      draft.connections = [...draft.connections, { ...step, name: "" }];
    }, true);
  }

  return (
    <CollapsibleSection
      title="Connections"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((value) => !value)}
    >
      {connections.length === 0 && (
        <div className="empty-state">This node declares no connections.</div>
      )}

      {connections.map((connection, index) => (
        <StepCard
          key={`${index}-${structureRevision}`}
          step={connection}
          moduleSchema={moduleSchemaFor(modules, connection.type)}
          onChange={(next) => setConnection(index, next)}
          onMoveUp={() => moveConnection(index, -1)}
          onMoveDown={() => moveConnection(index, 1)}
          onRemove={() => removeConnection(index)}
          canMoveUp={index > 0}
          canMoveDown={index < connections.length - 1}
          otherTaskNames={[]}
          pathPrefix={`connections[${index}]`}
          errors={errors}
          showRescue={false}
          nameFieldDescription="Required, unique: how steps refer to this connection via connectionName."
        />
      ))}

      <AddStepMenu
        label="+ Add connection"
        modules={modules}
        kinds={["connection"]}
        onAdd={addConnection}
      />
    </CollapsibleSection>
  );
}
