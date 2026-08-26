import { ConfigError } from "../types";

export interface ValidationPanelProps {
  errors: Array<ConfigError>;
  // True while a selected node's config hasn't loaded yet, so validation for
  // it has not run at all -- distinct from an empty errors array, which
  // means validation ran and found nothing.
  loading: boolean;
}

// A dotted path like "tasks.weather.steps[2].precision" is also the `id` a
// StepCard gives that exact field (see StepCard/TaskChain/ConnectionsPanel),
// so a click can jump straight to the offending control.
function jumpTo(path: string) {
  document
    .getElementById(path)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export default function ValidationPanel({
  errors,
  loading,
}: ValidationPanelProps) {
  if (loading) return <div className="validation-empty">Loading...</div>;

  if (!errors.length)
    return <div className="validation-empty">No problems found.</div>;

  const sorted = [...errors].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );

  return (
    <div>
      {sorted.map((error, index) => (
        <div
          key={index}
          className={`validation-entry ${error.severity}`}
          onClick={() => jumpTo(error.path)}
        >
          <span className="path">{error.path || "<config>"}</span>
          {error.message}
        </div>
      ))}
    </div>
  );
}
