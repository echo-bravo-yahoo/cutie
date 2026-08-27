import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LiveMessage, openMessageFeed, validateNode } from "./api";
import {
  formatValue,
  isMultilineValue,
  kindOf,
  stepOptions,
} from "./stepDisplay";
import { ConfigError, ConfigFile, StepConfig } from "./types";

// All grid-related constants are multiples of the 28px blueprint cell (see
// .dash-canvas's background in styles.css, which is what these need to
// match): TILE_WIDTH so a grid-aligned left edge leaves the right edge
// aligned too, TILE_WIDTH + TILE_GAP so initial columns snap without
// rounding drift, and SNAP -- every 2nd line, loosely, not every line.
const TILE_WIDTH = 252;
const TILE_GAP = 28;
const ROW_STEP = 56;
const SNAP = 56;

function snap(value: number): number {
  return Math.max(0, Math.round(value / SNAP) * SNAP);
}

function stepTopics(step: StepConfig): Array<string> {
  return Array.isArray(step.topics) ? (step.topics as Array<string>) : [];
}

// Every topic any trigger:mqtt/output:mqtt step in this node names -- used
// both to filter the live feed to "this node's own traffic" and to know
// which indicator dots have a real signal to show at all.
function collectTopics(config: ConfigFile): Array<string> {
  const topics = new Set<string>();
  for (const task of Object.values(config.tasks ?? {})) {
    const steps = [task.trigger, ...(task.steps ?? [])].filter(
      Boolean,
    ) as Array<StepConfig>;
    for (const step of steps)
      for (const topic of stepTopics(step)) topics.add(topic);
  }
  return [...topics];
}

// Identifies one step (a connection, a task's trigger, or one of a task's
// steps) -- the unit both field edits and loupes operate on.
interface FieldPath {
  kind: "connection" | "trigger" | "step";
  taskName?: string;
  index?: number;
}

function pathKey(path: FieldPath): string {
  if (path.kind === "connection") return `connection:${path.index}`;
  if (path.kind === "trigger") return `trigger:${path.taskName}`;
  return `step:${path.taskName}:${path.index}`;
}

function pathPrefix(path: FieldPath): string {
  if (path.kind === "connection") return `connections[${path.index}]`;
  if (path.kind === "trigger") return `tasks.${path.taskName}.trigger`;
  return `tasks.${path.taskName}.steps[${path.index}]`;
}

function stepAt(config: ConfigFile, path: FieldPath): StepConfig | undefined {
  if (path.kind === "connection")
    return config.connections[path.index!] as StepConfig | undefined;
  if (path.kind === "trigger")
    return config.tasks?.[path.taskName!]?.trigger as StepConfig | undefined;
  return config.tasks?.[path.taskName!]?.steps?.[path.index!] as
    | StepConfig
    | undefined;
}

function withField(
  config: ConfigFile,
  path: FieldPath,
  key: string,
  value: unknown,
): ConfigFile {
  const next = structuredClone(config);

  if (path.kind === "connection") {
    (next.connections[path.index!] as StepConfig)[key] = value;
  } else if (path.kind === "trigger") {
    const task = next.tasks?.[path.taskName!];
    if (task?.trigger) (task.trigger as StepConfig)[key] = value;
  } else {
    const task = next.tasks?.[path.taskName!];
    if (task?.steps) (task.steps[path.index!] as StepConfig)[key] = value;
  }

  return next;
}

function errorsFor(
  errors: Array<ConfigError>,
  prefix: string,
): Array<ConfigError> {
  return errors.filter(
    (error) => error.path === prefix || error.path.startsWith(`${prefix}.`),
  );
}

// Pointer-capture drag: the same element keeps receiving pointermove/up even
// once the cursor leaves it, so no window-level listeners are needed. x/y are
// controlled from the caller's own position state. Tiles snap to the
// blueprint grid as they move; loupes (a tool floating above it, not part of
// the schematic) move freely.
function useDraggable(
  x: number,
  y: number,
  onMove: (x: number, y: number) => void,
  snapToGrid: boolean,
) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: x,
      baseY: y,
    };
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!dragging) return;
    const dx = event.clientX - origin.current.startX;
    const dy = event.clientY - origin.current.startY;
    const nextX = origin.current.baseX + dx;
    const nextY = origin.current.baseY + dy;
    onMove(
      snapToGrid ? snap(nextX) : Math.max(0, nextX),
      snapToGrid ? snap(nextY) : Math.max(0, nextY),
    );
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return { dragging, gripProps: { onPointerDown, onPointerMove, onPointerUp } };
}

function FieldValue({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const multiline = isMultilineValue(value);
  const [jsonText, setJsonText] = useState(() =>
    multiline ? formatValue(value) : "",
  );

  if (typeof value === "boolean")
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    );

  if (typeof value === "number")
    return (
      <input
        className="field-input"
        type="number"
        defaultValue={value}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (!Number.isNaN(next)) onChange(next);
        }}
      />
    );

  if (multiline)
    return (
      <textarea
        className="field-input multiline"
        value={jsonText}
        onChange={(event) => {
          const next = event.target.value;
          setJsonText(next);
          try {
            onChange(JSON.parse(next));
          } catch {
            // Not valid JSON yet -- keep the typed text, keep the last
            // valid value in the draft.
          }
        }}
      />
    );

  return (
    <input
      className="field-input"
      type="text"
      value={typeof value === "string" ? value : String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

// Read-only summary shown inside a tile -- type, name, and (if any) the
// errors and options, all as plain text. Editing happens in a Loupe instead,
// opened from the button here.
function Detail({
  step,
  errors,
  onEdit,
}: {
  step: StepConfig;
  errors: Array<ConfigError>;
  onEdit: () => void;
}) {
  const options = stepOptions(step);

  return (
    <div className={`dash-detail kind-${kindOf(step.type)}`}>
      <div className="dash-detail-head">
        <span className="dash-detail-type">{step.type}</span>
        {step.name && <span className="dash-detail-name">{step.name}</span>}
        <button className="dash-detail-edit" onClick={onEdit}>
          edit
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="dash-detail-errors">
          {errors.map((error, index) => (
            <li key={index} className={error.severity}>
              {error.message}
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <dl className="dash-detail-options">
          {options.map(([key, value]) => (
            <div
              key={key}
              className={isMultilineValue(value) ? "multiline" : ""}
            >
              <dt>{key}</dt>
              <dd>
                <span
                  className={`dash-value${isMultilineValue(value) ? " multiline" : ""}`}
                >
                  {formatValue(value)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Dot({
  step,
  activeTopics,
  pulseTokens,
}: {
  step: StepConfig;
  activeTopics: Set<string>;
  pulseTokens: Map<string, number>;
}) {
  const topics = stepTopics(step);
  const active = topics.some((topic) => activeTopics.has(topic));
  const pulse = topics.reduce(
    (max, topic) => Math.max(max, pulseTokens.get(topic) ?? 0),
    0,
  );

  return (
    <span
      className={`dash-dot kind-${kindOf(step.type)}${active ? " active" : ""}`}
      title={step.type}
    >
      {pulse > 0 && <span key={pulse} className="dash-ping" />}
    </span>
  );
}

function ConnectionDot({
  step,
  active,
  pulseToken,
}: {
  step: StepConfig;
  active: boolean;
  pulseToken: number;
}) {
  return (
    <span
      className={`dash-dot kind-${kindOf(step.type)}${active ? " active" : ""}`}
      title={step.type}
    >
      {pulseToken > 0 && <span key={pulseToken} className="dash-ping" />}
    </span>
  );
}

interface TileShellProps {
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  hasError: boolean;
  open: boolean;
  onToggle: () => void;
  name: string;
  dots: React.ReactNode;
  count?: number;
  children?: React.ReactNode;
}

function TileShell({
  x,
  y,
  onMove,
  hasError,
  open,
  onToggle,
  name,
  dots,
  count,
  children,
}: TileShellProps) {
  const { dragging, gripProps } = useDraggable(x, y, onMove, true);

  return (
    <div
      className={`dash-tile${open ? " open" : ""}${dragging ? " dragging" : ""}${hasError ? " has-error" : ""}`}
      style={{ left: x, top: y }}
    >
      <div className="dash-tile-head">
        <span className="dash-grip" title="Drag to move" {...gripProps}>
          ::
        </span>
        <button className="dash-tile-clickable" onClick={onToggle}>
          <span className="dash-tile-name">{name}</span>
          <span className="dash-tile-dots">{dots}</span>
          {count !== undefined && (
            <span className="dash-tile-count">{count}</span>
          )}
        </button>
      </div>
      {open && <div className="dash-tile-body">{children}</div>}
    </div>
  );
}

function TaskTile({
  taskName,
  steps,
  hasTrigger,
  x,
  y,
  onMove,
  onEditStep,
  errorsByStep,
  activeTopics,
  pulseTokens,
}: {
  taskName: string;
  steps: Array<StepConfig>;
  hasTrigger: boolean;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onEditStep: (stepIndex: number) => void;
  errorsByStep: Array<Array<ConfigError>>;
  activeTopics: Set<string>;
  pulseTokens: Map<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const hasError = errorsByStep.some((errors) =>
    errors.some((error) => error.severity === "error"),
  );

  return (
    <TileShell
      x={x}
      y={y}
      onMove={onMove}
      hasError={hasError}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      name={taskName}
      count={steps.length}
      dots={steps.map((step, index) => (
        <Dot
          key={index}
          step={step}
          activeTopics={activeTopics}
          pulseTokens={pulseTokens}
        />
      ))}
    >
      {steps.map((step, index) => (
        <Detail
          key={index}
          step={step}
          errors={errorsByStep[index] ?? []}
          onEdit={() => onEditStep(index)}
        />
      ))}
      {!hasTrigger && (
        <p className="dash-detail-note">No trigger set on this task.</p>
      )}
    </TileShell>
  );
}

function ConnectionTile({
  step,
  x,
  y,
  onMove,
  onEdit,
  errors,
  active,
  pulseToken,
}: {
  step: StepConfig;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onEdit: () => void;
  errors: Array<ConfigError>;
  active: boolean;
  pulseToken: number;
}) {
  const [open, setOpen] = useState(false);
  const hasError = errors.some((error) => error.severity === "error");

  return (
    <TileShell
      x={x}
      y={y}
      onMove={onMove}
      hasError={hasError}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      name={step.name || step.type}
      dots={
        <ConnectionDot step={step} active={active} pulseToken={pulseToken} />
      }
    >
      <Detail step={step} errors={errors} onEdit={onEdit} />
    </TileShell>
  );
}

// The magnifying-glass editor for one step: opened from its Detail's "edit"
// button, freely draggable, closeable. Multiple can be open at once.
function Loupe({
  x,
  y,
  z,
  step,
  errors,
  onFieldChange,
  onMove,
  onFocus,
  onClose,
}: {
  x: number;
  y: number;
  z: number;
  step: StepConfig;
  errors: Array<ConfigError>;
  onFieldChange: (key: string, value: unknown) => void;
  onMove: (x: number, y: number) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const { gripProps } = useDraggable(x, y, onMove, false);
  const options = stepOptions(step);

  return (
    <div
      className={`loupe kind-${kindOf(step.type)}`}
      style={{ left: x, top: y, zIndex: z }}
      onPointerDownCapture={onFocus}
    >
      <div className="loupe-head" {...gripProps}>
        <span className="loupe-grip">::</span>
        <span className="loupe-type">{step.type}</span>
        {step.name && <span className="loupe-name">{step.name}</span>}
        <button
          className="loupe-close"
          onPointerDownCapture={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          x
        </button>
      </div>
      <div className="loupe-body">
        {errors.length > 0 && (
          <ul className="loupe-errors">
            {errors.map((error, index) => (
              <li key={index} className={error.severity}>
                {error.message}
              </li>
            ))}
          </ul>
        )}
        {options.length === 0 ? (
          <p className="loupe-empty">Nothing to edit on this step.</p>
        ) : (
          <dl className="loupe-fields">
            {options.map(([key, value]) => (
              <div
                key={key}
                className={isMultilineValue(value) ? "multiline" : ""}
              >
                <dt>{key}</dt>
                <dd>
                  <FieldValue
                    value={value}
                    onChange={(next) => onFieldChange(key, next)}
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

// The real app's right-hand rail, always visible (not a collapsible drawer --
// that hid content the whole point was to keep in view).
function Rail({
  errors,
  messages,
  showAll,
  onShowAllChange,
  nodeTopicCount,
}: {
  errors: Array<ConfigError>;
  messages: Array<LiveMessage>;
  showAll: boolean;
  onShowAllChange: (value: boolean) => void;
  nodeTopicCount: number;
}) {
  return (
    <aside className="board-rail">
      <section>
        <h3>Validation</h3>
        {errors.length === 0 ? (
          <p className="dash-drawer-empty">No problems found.</p>
        ) : (
          <ul className="dash-drawer-list">
            {errors.map((error, index) => (
              <li key={index} className={error.severity}>
                <span className="path">{error.path || "<config>"}</span>
                {error.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="board-rail-messages">
        <div className="dash-drawer-section-head">
          <h3>Live messages</h3>
          <label>
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => onShowAllChange(event.target.checked)}
            />
            show everything
          </label>
        </div>
        <span className="dash-drawer-hint">
          {showAll || nodeTopicCount === 0
            ? "showing the whole broker"
            : `filtered to ${nodeTopicCount} known topic(s)`}
        </span>
        {messages.length === 0 ? (
          <p className="dash-drawer-empty">No messages yet.</p>
        ) : (
          <ul className="dash-drawer-list mono">
            {messages.slice(0, 60).map((message, index) => (
              <li key={index}>
                <span className="topic">{message.topic}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

interface OpenLoupe {
  key: string;
  path: FieldPath;
  x: number;
  y: number;
  z: number;
}

export default function Board({
  nodeName,
  config,
}: {
  nodeName: string;
  config: ConfigFile;
}) {
  const [draft, setDraft] = useState(config);
  const [errors, setErrors] = useState<Array<ConfigError>>([]);
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [loupes, setLoupes] = useState<Array<OpenLoupe>>([]);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [recentMessages, setRecentMessages] = useState<Array<LiveMessage>>([]);
  const [activeTopics, setActiveTopics] = useState<Set<string>>(new Set());
  const [pulseTokens, setPulseTokens] = useState<Map<string, number>>(
    new Map(),
  );
  const [connectionActive, setConnectionActive] = useState(false);
  const [connectionPulse, setConnectionPulse] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const topZRef = useRef(1);

  const nodeTopics = useMemo(() => collectTopics(config), [config]);
  const nodeTopicsRef = useRef(nodeTopics);
  useEffect(() => {
    nodeTopicsRef.current = nodeTopics;
  }, [nodeTopics]);

  // Reset everything scoped to "the node currently being looked at" when the
  // dropdown picks a different one -- draft edits, layout, open loupes, and
  // the live signal history all belong to whichever node is on screen.
  useEffect(() => {
    setDraft(config);
    setErrors([]);
    setLoupes([]);
    setRecentMessages([]);
    setActiveTopics(new Set());
    setPulseTokens(new Map());
    setConnectionActive(false);

    const taskEntries = Object.entries(config.tasks ?? {});
    const keys = [
      ...config.connections.map((_, index) => `connection:${index}`),
      ...taskEntries.map(([taskName]) => `task:${taskName}`),
    ];
    const width = containerRef.current?.clientWidth ?? 1100;
    const cols = Math.max(
      1,
      Math.floor((width + TILE_GAP) / (TILE_WIDTH + TILE_GAP)),
    );
    const next: Record<string, { x: number; y: number }> = {};
    keys.forEach((key, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      next[key] = {
        x: snap(col * (TILE_WIDTH + TILE_GAP)),
        y: snap(row * ROW_STEP),
      };
    });
    setPositions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeName, config]);

  // Opened once for the component's lifetime, not per node -- nodeTopicsRef
  // keeps the handler's filtering current without tearing down the socket
  // every time the dropdown changes.
  useEffect(() => {
    return openMessageFeed((message) => {
      setRecentMessages((prev) => [message, ...prev].slice(0, 60));

      if (nodeTopicsRef.current.includes(message.topic)) {
        setActiveTopics((prev) => new Set(prev).add(message.topic));
        setPulseTokens((prev) => {
          const next = new Map(prev);
          next.set(message.topic, (next.get(message.topic) ?? 0) + 1);
          return next;
        });
      }

      // The live feed comes in over serve-ui's own single connection, so any
      // message at all is real traffic on it -- there's no way to attribute
      // a message to one of several connections a node might declare.
      setConnectionActive(true);
      setConnectionPulse((count) => count + 1);
    });
  }, []);

  // Validation runs unconditionally -- there is no separate "edit mode" to
  // gate it behind anymore, so a node's pre-existing problems show up
  // immediately, and edits made through any loupe keep it current.
  useEffect(() => {
    const timer = setTimeout(() => {
      validateNode(nodeName, draft)
        .then(setErrors)
        .catch(() => {});
    }, 400);

    return () => clearTimeout(timer);
  }, [nodeName, draft]);

  const tasks = Object.entries(draft.tasks ?? {});
  const errorCount = errors.filter(
    (error) => error.severity === "error",
  ).length;
  const canvasHeight =
    Math.max(400, ...Object.values(positions).map((p) => p.y)) + 320;
  const displayedMessages = showAllMessages
    ? recentMessages
    : recentMessages.filter((message) => nodeTopics.includes(message.topic));

  function movePosition(key: string, x: number, y: number) {
    setPositions((prev) => ({ ...prev, [key]: { x, y } }));
  }

  function openLoupe(path: FieldPath, atX: number, atY: number) {
    const key = pathKey(path);
    topZRef.current += 1;
    setLoupes((prev) => {
      const existing = prev.find((loupe) => loupe.key === key);
      if (existing)
        return prev.map((loupe) =>
          loupe.key === key ? { ...loupe, z: topZRef.current } : loupe,
        );
      return [...prev, { key, path, x: atX, y: atY, z: topZRef.current }];
    });
  }

  function focusLoupe(key: string) {
    topZRef.current += 1;
    const z = topZRef.current;
    setLoupes((prev) =>
      prev.map((loupe) => (loupe.key === key ? { ...loupe, z } : loupe)),
    );
  }

  function closeLoupe(key: string) {
    setLoupes((prev) => prev.filter((loupe) => loupe.key !== key));
  }

  function moveLoupe(key: string, x: number, y: number) {
    setLoupes((prev) =>
      prev.map((loupe) => (loupe.key === key ? { ...loupe, x, y } : loupe)),
    );
  }

  function editField(path: FieldPath, key: string, value: unknown) {
    setDraft((prev) => withField(prev, path, key, value));
  }

  return (
    <div className="board">
      <header className="board-header">
        <h2>{nodeName}</h2>
        <span className="dash-summary">
          {draft.connections.length} connection(s), {tasks.length} task(s)
          {errorCount > 0 && (
            <span className="dash-error-count"> -- {errorCount} error(s)</span>
          )}
        </span>
      </header>

      <div className="board-layout">
        <div className="board-canvas-wrap">
          <div
            className="dash-canvas"
            ref={containerRef}
            style={{ height: canvasHeight }}
          >
            {draft.connections.map((connection, index) => {
              const key = `connection:${index}`;
              const position = positions[key] ?? { x: 0, y: 0 };
              const path: FieldPath = { kind: "connection", index };

              return (
                <ConnectionTile
                  key={key}
                  step={connection}
                  x={position.x}
                  y={position.y}
                  onMove={(x, y) => movePosition(key, x, y)}
                  onEdit={() => openLoupe(path, position.x + 280, position.y)}
                  errors={errorsFor(errors, pathPrefix(path))}
                  active={connectionActive}
                  pulseToken={connectionPulse}
                />
              );
            })}

            {tasks.map(([taskName, task]) => {
              const key = `task:${taskName}`;
              const position = positions[key] ?? { x: 0, y: 0 };
              const hasTrigger = !!task.trigger;
              const steps = [task.trigger, ...(task.steps ?? [])].filter(
                Boolean,
              ) as Array<StepConfig>;

              return (
                <TaskTile
                  key={key}
                  taskName={taskName}
                  steps={steps}
                  hasTrigger={hasTrigger}
                  x={position.x}
                  y={position.y}
                  onMove={(x, y) => movePosition(key, x, y)}
                  onEditStep={(stepIndex) => {
                    const path: FieldPath =
                      hasTrigger && stepIndex === 0
                        ? { kind: "trigger", taskName }
                        : {
                            kind: "step",
                            taskName,
                            index: hasTrigger ? stepIndex - 1 : stepIndex,
                          };
                    openLoupe(path, position.x + 280, position.y);
                  }}
                  errorsByStep={steps.map((_, stepIndex) => {
                    const path: FieldPath =
                      hasTrigger && stepIndex === 0
                        ? { kind: "trigger", taskName }
                        : {
                            kind: "step",
                            taskName,
                            index: hasTrigger ? stepIndex - 1 : stepIndex,
                          };
                    return errorsFor(errors, pathPrefix(path));
                  })}
                  activeTopics={activeTopics}
                  pulseTokens={pulseTokens}
                />
              );
            })}
          </div>

          {tasks.length === 0 && draft.connections.length === 0 && (
            <p className="dash-empty">This node declares nothing.</p>
          )}
        </div>

        <Rail
          errors={errors}
          messages={displayedMessages}
          showAll={showAllMessages}
          onShowAllChange={setShowAllMessages}
          nodeTopicCount={nodeTopics.length}
        />
      </div>

      {loupes.map((loupe) => {
        const step = stepAt(draft, loupe.path);
        if (!step) return null;

        return (
          <Loupe
            key={loupe.key}
            x={loupe.x}
            y={loupe.y}
            z={loupe.z}
            step={step}
            errors={errorsFor(errors, pathPrefix(loupe.path))}
            onFieldChange={(key, value) => editField(loupe.path, key, value)}
            onMove={(x, y) => moveLoupe(loupe.key, x, y)}
            onFocus={() => focusLoupe(loupe.key)}
            onClose={() => closeLoupe(loupe.key)}
          />
        );
      })}
    </div>
  );
}
