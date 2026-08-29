import {
  PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
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
// rounding drift, ROW_STEP with a full cell of breathing room between rows
// to match, and SNAP -- every line.
const GRID_CELL = 28;
const TILE_WIDTH = GRID_CELL * 9;
const TILE_GAP = GRID_CELL;
const ROW_STEP = GRID_CELL * 3;
const SNAP = GRID_CELL;

// How many step dots a task tile shows before collapsing the rest into gap
// markers (see selectVisibleStepIndices).
const MAX_VISIBLE_DOTS = 8;
// Loupe placement: how far past the tile's right edge it opens, and its own
// width (matches .loupe's CSS width) so it can be kept on screen.
const LOUPE_GAP = 16;
const LOUPE_WIDTH = 300;
// Live-message retention: how many messages each individual topic keeps
// (immune to unrelated topics' traffic), and a render-only cap on the
// flattened/sorted view shown when "show everything" spans many topics.
const MESSAGES_PER_TOPIC = 50;
const MESSAGE_DISPLAY_LIMIT = 500;

// How far a tile's own box sits inside the grid slot it occupies, on every
// side, so the blueprint shows through as a border around it rather than
// disappearing under a flush edge.
const TILE_INSET = 4;

// A closed tile's real height (.dash-tile-head's 46px + 1px top/bottom
// border + TILE_INSET*2 top/bottom = 56px, 2 grid cells -- see the matching
// comment on .dash-tile-head in styles.css) -- used as the canvas-height
// floor for a tile whose real height hasn't been measured yet (see
// TileShell's ResizeObserver, below).
const DEFAULT_TILE_HEIGHT = GRID_CELL * 2;

// .board-canvas-wrap's own left/right padding in styles.css -- subtracted
// out below so the canvas's own size lands on a grid multiple, not the
// padded box around it.
const CANVAS_PADDING_X = 24;

function snap(value: number): number {
  return Math.max(0, Math.round(value / SNAP) * SNAP);
}

// The widest a grid-aligned canvas can be within whatever room the wrap
// currently has, floored to the nearest cell so the background pattern
// (and any tile positioned near the edge) never gets cut mid-cell.
function availableCanvasWidth(wrap: HTMLDivElement | null): number {
  const raw = (wrap?.clientWidth ?? 1100) - CANVAS_PADDING_X * 2;
  return Math.max(GRID_CELL, Math.floor(raw / GRID_CELL) * GRID_CELL);
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

// One output:event step's broadcast to one trigger:event task -- the runtime
// fans one emit() out to every listener sharing its key (see event.ts on both
// sides, and globals.ts's single per-process EventEmitter), so this is a
// pairing, not an exclusive edge: one key can produce many of these.
interface EventEdge {
  key: string;
  fromTaskName: string;
  toTaskName: string;
}

// Every output:event -> trigger:event pairing across the whole config, by
// matching key. Deliberately the full N-emitters x M-listeners cross product
// (matching the runtime's real broadcast semantics), not special-cased to
// "one emitter" -- correct for any fleet config. An orphaned key on either
// side just produces no edge; cutie validate has no cross-check for this (see
// validate.ts), so a missing arrow here is the only signal a typo exists.
function collectEventEdges(config: ConfigFile): Array<EventEdge> {
  const emitters: Array<{ taskName: string; key: string }> = [];
  const listeners: Array<{ taskName: string; key: string }> = [];

  for (const [taskName, task] of Object.entries(config.tasks ?? {})) {
    if (
      task.trigger &&
      task.trigger.type === "trigger:event" &&
      typeof task.trigger.key === "string"
    ) {
      listeners.push({ taskName, key: task.trigger.key });
    }
    for (const step of task.steps ?? []) {
      if (step.type === "output:event" && typeof step.key === "string") {
        emitters.push({ taskName, key: step.key });
      }
    }
  }

  const edges: Array<EventEdge> = [];
  for (const emitter of emitters)
    for (const listener of listeners)
      if (listener.key === emitter.key)
        edges.push({
          key: emitter.key,
          fromTaskName: emitter.taskName,
          toTaskName: listener.taskName,
        });
  return edges;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function tileRect(
  key: string,
  positions: Record<string, { x: number; y: number }>,
  tileHeights: Record<string, number>,
): Rect {
  const p = positions[key] ?? { x: 0, y: 0 };
  return {
    left: p.x + TILE_INSET,
    top: p.y + TILE_INSET,
    width: TILE_WIDTH - TILE_INSET * 2,
    height: tileHeights[key] ?? DEFAULT_TILE_HEIGHT,
  };
}

// Clips a ray from a rect's own center toward an external point to that
// rect's boundary -- used twice per edge (once from each tile, aimed at the
// other tile's center) so an arrow always starts/ends exactly on a tile's
// edge, regardless of the tiles' relative position after dragging.
function clipToRectBoundary(
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  towardX: number,
  towardY: number,
): { x: number; y: number } {
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx !== 0 ? halfWidth / Math.abs(dx) : Infinity,
    dy !== 0 ? halfHeight / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function eventArrowPoints(source: Rect, target: Rect) {
  const sourceCenter = {
    x: source.left + source.width / 2,
    y: source.top + source.height / 2,
  };
  const targetCenter = {
    x: target.left + target.width / 2,
    y: target.top + target.height / 2,
  };
  return {
    start: clipToRectBoundary(
      sourceCenter.x,
      sourceCenter.y,
      source.width / 2,
      source.height / 2,
      targetCenter.x,
      targetCenter.y,
    ),
    end: clipToRectBoundary(
      targetCenter.x,
      targetCenter.y,
      target.width / 2,
      target.height / 2,
      sourceCenter.x,
      sourceCenter.y,
    ),
  };
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

// A task's trigger and steps render as one combined list (trigger first,
// when present) -- this resolves one of that list's indices back to the
// FieldPath it actually refers to, shared by every place that needs to (edit,
// error lookup, open-loupe lookup).
function stepPathAt(
  taskName: string,
  hasTrigger: boolean,
  stepIndex: number,
): FieldPath {
  return hasTrigger && stepIndex === 0
    ? { kind: "trigger", taskName }
    : { kind: "step", taskName, index: hasTrigger ? stepIndex - 1 : stepIndex };
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
  isEditing,
  onEdit,
}: {
  step: StepConfig;
  errors: Array<ConfigError>;
  isEditing: boolean;
  onEdit: (anchor: HTMLElement) => void;
}) {
  const options = stepOptions(step);

  return (
    <div className={`dash-detail kind-${kindOf(step.type)}`}>
      <div className="dash-detail-head">
        <span className="dash-detail-type">{step.type}</span>
        {step.name && <span className="dash-detail-name">{step.name}</span>}
        <button
          className={`dash-detail-edit${isEditing ? " open" : ""}`}
          onClick={(event) => onEdit(event.currentTarget)}
        >
          {isEditing ? "editing" : "edit"}
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

// Matches a JSON string (key or value), true/false/null, or a number --
// everything between matches (braces, commas, colons, whitespace) is left as
// plain text for the caller to push through unwrapped.
const JSON_TOKEN =
  /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function classifyJsonToken(raw: string): "key" | "string" | "boolean" | "null" | "number" {
  if (raw.startsWith('"')) return raw.trimEnd().endsWith(":") ? "key" : "string";
  if (raw === "true" || raw === "false") return "boolean";
  if (raw === "null") return "null";
  return "number";
}

// Colors JSON syntax within already-formatted text, built as real React text
// nodes -- never dangerouslySetInnerHTML. Message payloads are live,
// untrusted broker data, so raw HTML injection here would be a real XSS
// vector; React escapes plain-string children automatically instead.
function renderJsonTokens(text: string): Array<React.ReactNode> {
  const nodes: Array<React.ReactNode> = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(JSON_TOKEN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <span key={key++} className={`json-${classifyJsonToken(raw)}`}>
        {raw}
      </span>,
    );
    cursor = start + raw.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// This gate is what keeps the tokenizer off raw string payloads: formatValue
// returns a string payload verbatim, un-stringified -- the common case for a
// message that isn't JSON (e.g. a plain-text "ON"). Running the token regex
// over that would mis-highlight incidental digits or the words
// true/false/null inside ordinary prose as if they were real JSON.
// isMultilineValue is only true for objects/arrays, so this only ever
// tokenizes text that formatValue actually ran JSON.stringify on.
function JsonPreview({ value }: { value: unknown }) {
  if (!isMultilineValue(value)) return <>{formatValue(value)}</>;
  return <>{renderJsonTokens(formatValue(value))}</>;
}

// Prefers steps that can actually show real activity (a real topic to
// watch) over ones that structurally never can -- see
// stepTopics/collectTopics above. Ignores gap markers entirely; that's
// selectVisibleStepIndices's job below.
function pickStepsByPriority(
  steps: Array<StepConfig>,
  budget: number,
): Set<number> {
  const indices = steps.map((_, index) => index);
  const withSignal = indices.filter((i) => stepTopics(steps[i]).length > 0);
  const withoutSignal = indices.filter(
    (i) => stepTopics(steps[i]).length === 0,
  );
  const shown = withSignal.slice(0, budget);
  if (shown.length < budget)
    shown.push(...withoutSignal.slice(0, budget - shown.length));
  return new Set(shown);
}

// How many separate runs of hidden steps a visible set leaves behind -- each
// one gets its own gap marker (see TaskTile), and that marker takes a dot's
// place in the row, not an extra one.
function countGapRuns(
  steps: Array<StepConfig>,
  visible: Set<number>,
): number {
  let runs = 0;
  let inGap = false;
  steps.forEach((_, index) => {
    if (visible.has(index)) inGap = false;
    else if (!inGap) {
      runs++;
      inGap = true;
    }
  });
  return runs;
}

// Once a task has more steps than fit as dots, shrink the dot budget until
// shown-dots + needed-gap-markers actually fits max -- a gap marker occupies
// a slot the same as a dot does, so it must count against the same cap
// rather than appearing in addition to a full set of dots.
function selectVisibleStepIndices(
  steps: Array<StepConfig>,
  max: number,
): Set<number> {
  if (steps.length <= max) return new Set(steps.map((_, index) => index));

  for (let budget = max; budget >= 0; budget--) {
    const visible = pickStepsByPriority(steps, budget);
    if (visible.size + countGapRuns(steps, visible) <= max) return visible;
  }
  return new Set();
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
  const hasSignal = topics.length > 0;
  const active = topics.some((topic) => activeTopics.has(topic));
  const pulse = topics.reduce(
    (max, topic) => Math.max(max, pulseTokens.get(topic) ?? 0),
    0,
  );

  return (
    <span
      className={`dash-dot kind-${kindOf(step.type)}${active ? " active" : ""}${!hasSignal ? " no-signal" : ""}`}
      title={
        hasSignal
          ? step.type
          : `${step.type} -- no live signal available for this step type`
      }
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
  tileKey: string;
  onHeightChange: (key: string, height: number) => void;
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
  tileKey,
  onHeightChange,
}: TileShellProps) {
  const { dragging, gripProps } = useDraggable(x, y, onMove, true);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [nameTruncated, setNameTruncated] = useState(false);

  // Tracks the tile's own real rendered height -- which changes when it
  // opens/closes, and can keep changing while open as its content does (a
  // step gaining/losing a validation error) -- so Board's canvas height can
  // grow to actually contain it, not just assume a closed tile's height.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const report = () => onHeightChange(tileKey, el.offsetHeight);
    report();

    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tileKey, onHeightChange]);

  // Only a name CSS is actually clipping (scrollWidth exceeding the box it's
  // rendered into) gets a hover tooltip -- a name that already fits in full
  // doesn't need one repeating what's already fully visible. Re-checked via
  // ResizeObserver, not just on mount, since the space available to the name
  // shifts with how many dots the row ends up showing.
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;

    const check = () => setNameTruncated(el.scrollWidth > el.clientWidth);
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [name]);

  return (
    <div
      ref={rootRef}
      className={`dash-tile${open ? " open" : ""}${dragging ? " dragging" : ""}${hasError ? " has-error" : ""}`}
      style={{
        left: x + TILE_INSET,
        top: y + TILE_INSET,
        width: TILE_WIDTH - TILE_INSET * 2,
      }}
    >
      <div className="dash-tile-head">
        <span className="dash-grip" title="Drag to move" {...gripProps}>
          ::
        </span>
        <button className="dash-tile-clickable" onClick={onToggle}>
          <span
            className="dash-tile-name"
            ref={nameRef}
            title={nameTruncated ? name : undefined}
          >
            {name}
          </span>
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
  openByStep,
  activeTopics,
  pulseTokens,
  tileKey,
  onHeightChange,
}: {
  taskName: string;
  steps: Array<StepConfig>;
  hasTrigger: boolean;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onEditStep: (stepIndex: number, anchor: HTMLElement) => void;
  errorsByStep: Array<Array<ConfigError>>;
  openByStep: Array<boolean>;
  activeTopics: Set<string>;
  pulseTokens: Map<string, number>;
  tileKey: string;
  onHeightChange: (key: string, height: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasError = errorsByStep.some((errors) =>
    errors.some((error) => error.severity === "error"),
  );

  const visibleDots = selectVisibleStepIndices(steps, MAX_VISIBLE_DOTS);
  const dotNodes: Array<React.ReactNode> = [];
  let inGap = false;
  steps.forEach((step, index) => {
    if (visibleDots.has(index)) {
      dotNodes.push(
        <Dot
          key={index}
          step={step}
          activeTopics={activeTopics}
          pulseTokens={pulseTokens}
        />,
      );
      inGap = false;
    } else if (!inGap) {
      dotNodes.push(
        <span
          key={`gap-${index}`}
          className="dash-dot-ellipsis"
          title="More steps not shown here"
        />,
      );
      inGap = true;
    }
  });

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
      dots={dotNodes}
      tileKey={tileKey}
      onHeightChange={onHeightChange}
    >
      {steps.map((step, index) => (
        <Detail
          key={index}
          step={step}
          errors={errorsByStep[index] ?? []}
          isEditing={openByStep[index] ?? false}
          onEdit={(anchor) => onEditStep(index, anchor)}
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
  isEditing,
  active,
  pulseToken,
  tileKey,
  onHeightChange,
}: {
  step: StepConfig;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onEdit: (anchor: HTMLElement) => void;
  errors: Array<ConfigError>;
  isEditing: boolean;
  active: boolean;
  pulseToken: number;
  tileKey: string;
  onHeightChange: (key: string, height: number) => void;
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
      tileKey={tileKey}
      onHeightChange={onHeightChange}
    >
      <Detail
        step={step}
        errors={errors}
        isEditing={isEditing}
        onEdit={onEdit}
      />
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

// A live message plus a stable, monotonically increasing id -- assigned once
// per message as it arrives, so rows can be keyed by identity instead of
// array index (which breaks once messages prepend and get re-sorted).
interface KeyedMessage extends LiveMessage {
  id: number;
}

const MessageRow = memo(function MessageRow({
  message,
}: {
  message: KeyedMessage;
}) {
  return (
    <li>
      <span className="topic">{message.topic}</span>
      <span
        className={`payload${isMultilineValue(message.payload) ? " multiline" : ""}`}
      >
        <JsonPreview value={message.payload} />
      </span>
    </li>
  );
});

// Live Messages' own scroll region, isolated from Validation above it (see
// .board-rail-messages in styles.css). Anchors scroll position when a new
// message prepends: a reader scrolled away from the top sees the view hold
// steady instead of getting yanked, since prepending changes which messages
// sit at a given scrollTop without changing scrollTop itself.
function LiveMessagesList({ messages }: { messages: Array<KeyedMessage> }) {
  const listRef = useRef<HTMLUListElement>(null);
  const prevScroll = useRef({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const { top, height } = prevScroll.current;
    if (top > 4) el.scrollTop = top + (el.scrollHeight - height);
    prevScroll.current = { top: el.scrollTop, height: el.scrollHeight };
  }, [messages]);

  function trackScroll() {
    const el = listRef.current;
    if (el) prevScroll.current = { top: el.scrollTop, height: el.scrollHeight };
  }

  return (
    <ul className="dash-drawer-list mono" ref={listRef} onScroll={trackScroll}>
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
    </ul>
  );
}

// The real app's right-hand rail: validation and live messages. Collapses to
// a thin strip (not hidden entirely) so there is always something visible to
// click back to it.
function Rail({
  collapsed,
  onToggleCollapsed,
  errors,
  messages,
  showAll,
  onShowAllChange,
  nodeTopicCount,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  errors: Array<ConfigError>;
  messages: Array<KeyedMessage>;
  showAll: boolean;
  onShowAllChange: (value: boolean) => void;
  nodeTopicCount: number;
}) {
  return (
    <aside className={`board-rail${collapsed ? " collapsed" : ""}`}>
      <div className="board-rail-head">
        <button
          className="board-rail-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? "Show validation and live messages" : "Hide"}
        >
          {collapsed ? "<<" : ">>"}
        </button>
      </div>
      {!collapsed && (
        <>
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
              <LiveMessagesList messages={messages} />
            )}
          </section>
        </>
      )}
    </aside>
  );
}

// Structural overlay: one arrow per output:event -> trigger:event pairing
// (see collectEventEdges), showing declared wiring rather than observed
// traffic -- complements, not replaces, each step's own activity dot. No
// viewBox on purpose: .dash-canvas already sets an explicit pixel
// width/height inline, and this SVG (styles.css: inset: 0; width/height:
// 100%) inherits that exact pixel box, so with no viewBox its user-coordinate
// system is 1:1 CSS pixels and x1/y1/x2/y2 line up directly with
// positions/TILE_WIDTH with no scaling math.
function EventArrows({
  edges,
  positions,
  tileHeights,
}: {
  edges: Array<EventEdge>;
  positions: Record<string, { x: number; y: number }>;
  tileHeights: Record<string, number>;
}) {
  return (
    <svg className="dash-event-arrows">
      <defs>
        <marker
          id="event-arrow-head"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" className="dash-event-arrow-head" />
        </marker>
      </defs>
      {edges.map((edge, index) => {
        const source = tileRect(
          `task:${edge.fromTaskName}`,
          positions,
          tileHeights,
        );
        const target = tileRect(
          `task:${edge.toTaskName}`,
          positions,
          tileHeights,
        );
        const { start, end } = eventArrowPoints(source, target);
        return (
          <line
            key={`${edge.fromTaskName}->${edge.toTaskName}:${edge.key}:${index}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            className="dash-event-arrow kind-output"
            markerEnd="url(#event-arrow-head)"
          >
            <title>{`${edge.fromTaskName} -> ${edge.toTaskName} (event: ${edge.key})`}</title>
          </line>
        );
      })}
    </svg>
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
  const [tileHeights, setTileHeights] = useState<Record<string, number>>({});
  const reportTileHeight = useCallback((key: string, height: number) => {
    setTileHeights((prev) =>
      prev[key] === height ? prev : { ...prev, [key]: height },
    );
  }, []);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [messagesByTopic, setMessagesByTopic] = useState<
    Map<string, Array<KeyedMessage>>
  >(new Map());
  const nextMessageId = useRef(0);
  const [activeTopics, setActiveTopics] = useState<Set<string>>(new Set());
  const [pulseTokens, setPulseTokens] = useState<Map<string, number>>(
    new Map(),
  );
  const [connectionActive, setConnectionActive] = useState(false);
  const [connectionPulse, setConnectionPulse] = useState(0);
  // How much room .board-canvas-wrap's own viewport offers -- the canvas's
  // actual width (below, canvasWidth) is the larger of this and how far
  // right the content itself extends, so it's a floor, not the final value.
  const [viewportWidth, setViewportWidth] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const topZRef = useRef(1);

  // Tracks .board-canvas-wrap's own size (not the canvas's -- that's about to
  // be driven off this) so the canvas can be kept at an exact grid multiple
  // through window resizes, not just on first paint.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const measure = () => setViewportWidth(availableCanvasWidth(wrap));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const nodeTopics = useMemo(() => collectTopics(config), [config]);
  const eventEdges = useMemo(() => collectEventEdges(draft), [draft]);
  const nodeTopicsRef = useRef(nodeTopics);
  useEffect(() => {
    nodeTopicsRef.current = nodeTopics;
  }, [nodeTopics]);

  // Reset everything scoped to "the node currently being looked at" when the
  // dropdown picks a different one -- draft edits, layout, and open loupes.
  // The live feed (messagesByTopic/activeTopics/pulseTokens/connectionActive)
  // stays out of this: it comes from serve-ui's one connection to the whole
  // broker, not from this node specifically, so switching nodes has nothing
  // to do with whether that connection has seen traffic. Clearing it here
  // was wiping real history (and flipping the connection dot dark) on every
  // switch, with nothing having actually happened to the connection. It also
  // means there is no separate "filtered buffer" to go stale on a node
  // switch: messagesByTopic is the single, persistent source of truth, and
  // displayedMessages below is just a live projection over it.
  useEffect(() => {
    setDraft(config);
    setErrors([]);
    setLoupes([]);
    setTileHeights({});

    const taskEntries = Object.entries(config.tasks ?? {});
    const keys = [
      ...config.connections.map((_, index) => `connection:${index}`),
      ...taskEntries.map(([taskName]) => `task:${taskName}`),
    ];
    const width = availableCanvasWidth(wrapRef.current);
    const cols = Math.max(
      1,
      Math.floor((width + TILE_GAP) / (TILE_WIDTH + TILE_GAP)),
    );
    const next: Record<string, { x: number; y: number }> = {};
    keys.forEach((key, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      // Already exact grid multiples by construction (unlike a drag's
      // arbitrary drop point) -- snap() would round ROW_STEP's 3-cell step
      // to SNAP's 2-cell one and undo the vertical gap between rows.
      next[key] = {
        x: col * (TILE_WIDTH + TILE_GAP),
        y: row * ROW_STEP,
      };
    });
    setPositions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeName, config]);

  // Opened once for the component's lifetime, not per node -- nodeTopicsRef
  // keeps the handler's filtering current without tearing down the socket
  // every time the dropdown changes. Retention is one ring buffer per topic
  // (not one shared buffer for the whole broker) so a topic's own recent
  // history is immune to how busy other topics are.
  useEffect(() => {
    return openMessageFeed((message) => {
      const keyed: KeyedMessage = { ...message, id: nextMessageId.current++ };

      setMessagesByTopic((prev) => {
        const next = new Map(prev);
        const bucket = next.get(message.topic) ?? [];
        next.set(
          message.topic,
          [keyed, ...bucket].slice(0, MESSAGES_PER_TOPIC),
        );
        return next;
      });

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
  // Rounded up (not down, unlike the width) so the canvas is always at least
  // tall enough to hold the lowest tile plus its margin -- never a partial
  // cell short of it. Driven by each tile's own real measured height (see
  // TileShell's ResizeObserver), not just its position, so a tile expanding
  // open -- or growing further while open, e.g. picking up a validation
  // error -- pushes the canvas down to actually contain it, the same way
  // dragging a tile down already does. TILE_GAP below the tile's own bottom
  // edge matches the same "one grid cell of breathing room" the row spacing
  // (ROW_STEP) already leaves for a closed tile.
  const rawCanvasHeight = Math.max(
    400,
    ...Object.entries(positions).map(
      ([key, position]) =>
        position.y + (tileHeights[key] ?? DEFAULT_TILE_HEIGHT) + TILE_GAP,
    ),
  );
  const canvasHeight = Math.ceil(rawCanvasHeight / GRID_CELL) * GRID_CELL;
  // Mirrors the height logic above: the canvas grows to follow content
  // rightward the same way it already grows to follow content downward.
  // TILE_GAP (not height's much larger 320px buffer) matches the existing
  // column-spacing convention used everywhere else, since tiles never expand
  // horizontally the way an open tile's body expands vertically.
  const rawContentWidth =
    Math.max(0, ...Object.values(positions).map((p) => p.x)) +
    TILE_WIDTH +
    TILE_GAP;
  const contentWidth = Math.ceil(rawContentWidth / GRID_CELL) * GRID_CELL;
  const canvasWidth = Math.max(viewportWidth, contentWidth);

  // A plain flatten + sort, not a k-way merge -- fine at the scale a home
  // broker actually has (a few dozen distinct topics, each capped at
  // MESSAGES_PER_TOPIC). messagesByTopic itself is never reset on node
  // switch, so both the filtered and unfiltered branches read the same live
  // map, just with a different topic set applied.
  const displayedMessages = useMemo(() => {
    const onlyTopics =
      showAllMessages || nodeTopics.length === 0 ? null : new Set(nodeTopics);
    const merged: Array<KeyedMessage> = [];

    for (const [topic, bucket] of messagesByTopic) {
      if (onlyTopics && !onlyTopics.has(topic)) continue;
      merged.push(...bucket);
    }

    merged.sort((a, b) => b.id - a.id);
    return merged.slice(0, MESSAGE_DISPLAY_LIMIT);
  }, [messagesByTopic, showAllMessages, nodeTopics]);

  const openLoupeKeys = useMemo(
    () => new Set(loupes.map((loupe) => loupe.key)),
    [loupes],
  );

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

  // Positions a loupe from the real, current on-screen location of the
  // specific tile/step being edited (via the DOM, at the moment "edit" is
  // clicked) -- just past the tile's right edge, aligned with the step row.
  // Computed once at open-time from real viewport geometry, not re-tracked if
  // the canvas scrolls afterward: loupes are already meant to be dragged
  // freely once open, so that's correct and sufficient. This also sidesteps
  // a coordinate-system bug the old position.x/position.y approach had --
  // those are canvas-relative, but a Loupe renders position: fixed
  // (viewport-relative), so anything derived from them was wrong the moment
  // the canvas was scrolled at all.
  function openLoupeNear(path: FieldPath, anchor: HTMLElement) {
    const tileRect = anchor.closest(".dash-tile")?.getBoundingClientRect();
    const stepRect = anchor.closest(".dash-detail")?.getBoundingClientRect();
    const x = Math.min(
      (tileRect?.right ?? anchor.getBoundingClientRect().right) + LOUPE_GAP,
      window.innerWidth - LOUPE_WIDTH - 8,
    );
    const y = Math.max(
      8,
      Math.min(stepRect?.top ?? tileRect?.top ?? 0, window.innerHeight - 80),
    );
    openLoupe(path, x, y);
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
      <div className="board-layout">
        <div className="board-main">
          <header className="board-header">
            <h2>{nodeName}</h2>
            <span className="dash-summary">
              {draft.connections.length} connection(s), {tasks.length} task(s)
              {errorCount > 0 && (
                <span className="dash-error-count">
                  {" "}
                  -- {errorCount} error(s)
                </span>
              )}
            </span>
          </header>

          <div className="board-canvas-wrap" ref={wrapRef}>
            <div
              className="dash-canvas"
              style={{
                height: canvasHeight,
                width: canvasWidth || undefined,
              }}
            >
              <EventArrows
                edges={eventEdges}
                positions={positions}
                tileHeights={tileHeights}
              />

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
                    onEdit={(anchor) => openLoupeNear(path, anchor)}
                    errors={errorsFor(errors, pathPrefix(path))}
                    isEditing={openLoupeKeys.has(pathKey(path))}
                    active={connectionActive}
                    pulseToken={connectionPulse}
                    tileKey={key}
                    onHeightChange={reportTileHeight}
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
                    onEditStep={(stepIndex, anchor) => {
                      const path = stepPathAt(taskName, hasTrigger, stepIndex);
                      openLoupeNear(path, anchor);
                    }}
                    errorsByStep={steps.map((_, stepIndex) => {
                      const path = stepPathAt(taskName, hasTrigger, stepIndex);
                      return errorsFor(errors, pathPrefix(path));
                    })}
                    openByStep={steps.map((_, stepIndex) => {
                      const path = stepPathAt(taskName, hasTrigger, stepIndex);
                      return openLoupeKeys.has(pathKey(path));
                    })}
                    activeTopics={activeTopics}
                    pulseTokens={pulseTokens}
                    tileKey={key}
                    onHeightChange={reportTileHeight}
                  />
                );
              })}
            </div>

            {tasks.length === 0 && draft.connections.length === 0 && (
              <p className="dash-empty">This node declares nothing.</p>
            )}
          </div>
        </div>

        <Rail
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((value) => !value)}
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
