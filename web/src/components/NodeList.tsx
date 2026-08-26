import { pathForNode } from "../router";

export interface NodeListProps {
  nodeNames: Array<string>;
  selected: string | null;
  isDirty: boolean;
  // True while the node list itself hasn't loaded yet -- distinct from an
  // empty nodeNames, which only means "loaded, and there are none."
  loading: boolean;
  onSelect: (name: string) => void;
}

export default function NodeList({
  nodeNames,
  selected,
  isDirty,
  loading,
  onSelect,
}: NodeListProps) {
  if (loading) return <div className="empty-state">Loading...</div>;

  if (!nodeNames.length)
    return (
      <div className="empty-state">
        No nodes found. Any hostname with a retained message on
        cutie/config/&lt;name&gt; shows up here.
      </div>
    );

  return (
    <div>
      {nodeNames.map((name) => (
        <a
          key={name}
          href={pathForNode(name)}
          className={`node-list-item${name === selected ? " selected" : ""}`}
          onClick={(event) => {
            event.preventDefault();
            onSelect(name);
          }}
          title={name === selected ? "Click again to deselect" : undefined}
        >
          <span>{name}</span>
          {name === selected && isDirty && (
            <span className="dirty-dot" title="Unpublished changes" />
          )}
        </a>
      ))}
    </div>
  );
}
