export interface NodeListProps {
  nodeNames: Array<string>;
  selected: string | null;
  isDirty: boolean;
  onSelect: (name: string) => void;
}

export default function NodeList({
  nodeNames,
  selected,
  isDirty,
  onSelect,
}: NodeListProps) {
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
        <div
          key={name}
          className={`node-list-item${name === selected ? " selected" : ""}`}
          onClick={() => onSelect(name)}
          title={name === selected ? "Click again to deselect" : undefined}
        >
          <span>{name}</span>
          {name === selected && isDirty && (
            <span className="dirty-dot" title="Unpublished changes" />
          )}
        </div>
      ))}
    </div>
  );
}
