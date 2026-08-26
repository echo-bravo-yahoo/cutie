import { diffLines } from "diff";

import { ConfigFile } from "../types";

export interface CommitReviewModalProps {
  nodeName: string;
  before: ConfigFile;
  after: ConfigFile;
  publishing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function renderDiff(before: ConfigFile, after: ConfigFile) {
  const changes = diffLines(
    `${JSON.stringify(before, null, 2)}\n`,
    `${JSON.stringify(after, null, 2)}\n`,
  );

  return changes.flatMap((change, changeIndex) => {
    const kind = change.added ? "add" : change.removed ? "remove" : "context";
    const prefix = change.added ? "+ " : change.removed ? "- " : "  ";

    return change.value
      .replace(/\n$/, "")
      .split("\n")
      .map((line, lineIndex) => (
        <div
          className={`diff-line diff-${kind}`}
          key={`${changeIndex}-${lineIndex}`}
        >
          {prefix}
          {line}
        </div>
      ));
  });
}

export default function CommitReviewModal({
  nodeName,
  before,
  after,
  publishing,
  onCancel,
  onConfirm,
}: CommitReviewModalProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">Publish changes to "{nodeName}"?</div>
        <div className="modal-body">{renderDiff(before, after)}</div>
        <div className="modal-footer">
          <button onClick={onCancel} disabled={publishing}>
            Cancel
          </button>
          <button className="primary" onClick={onConfirm} disabled={publishing}>
            {publishing ? "Publishing..." : "Confirm & Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
