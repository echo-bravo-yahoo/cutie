import { ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

export interface CollapsibleSectionProps {
  id?: string;
  label?: string;
  title: string;
  monospaceTitle?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRemove?: () => void;
  extra?: ReactNode;
  children: ReactNode;
}

export default function CollapsibleSection({
  id,
  label,
  title,
  monospaceTitle,
  collapsed,
  onToggleCollapse,
  onRemove,
  extra,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="section-block" id={id}>
      <div className="section-header" onClick={onToggleCollapse}>
        <span className="collapse-arrow">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <h3>
          {label && <span className="section-label">{label}</span>}
          <span
            className={monospaceTitle ? "section-title mono" : "section-title"}
          >
            {title}
          </span>
        </h3>
        {onRemove && (
          <button
            className="icon"
            title="Remove"
            aria-label="Remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {extra}

      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  );
}
