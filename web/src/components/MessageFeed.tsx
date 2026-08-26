import { UIEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { LiveMessage } from "../api";

export interface MessageFeedProps {
  messages: Array<LiveMessage>;
  // The selected node's own statically-known output:mqtt topics; empty when
  // no node is selected or it declares none.
  nodeTopics: Array<string>;
}

// Below this, scrollTop is treated as "at the head" -- new messages are free
// to push the view forward there, since scrollTop 0 already shows whatever
// is now the first (newest) entry.
const HEAD_THRESHOLD_PX = 4;

export default function MessageFeed({
  messages,
  nodeTopics,
}: MessageFeedProps) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const scrollHeightRef = useRef(0);

  const filtered = useMemo(() => {
    if (showAll || nodeTopics.length === 0) return messages;
    const topicSet = new Set(nodeTopics);
    return messages.filter((message) => topicSet.has(message.topic));
  }, [messages, nodeTopics, showAll]);

  const visible = useMemo(() => filtered.slice(-100).reverse(), [filtered]);

  // Newest messages render first, so an arriving message is prepended above
  // whatever the reader is currently looking at. A reader scrolled to the
  // head keeps following the feed for free -- scrollTop stays 0, and index 0
  // is always whatever is newest. A reader scrolled away from the head gets
  // scrollTop nudged by exactly the height the new entries added above them,
  // so the messages on screen do not visually move. overflow-anchor is
  // turned off on this element (below) so the browser's own scroll-anchoring
  // heuristic never fights this.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;

    if (scrollTopRef.current > HEAD_THRESHOLD_PX) {
      const delta = el.scrollHeight - scrollHeightRef.current;
      el.scrollTop = scrollTopRef.current + delta;
    }

    scrollHeightRef.current = el.scrollHeight;
    scrollTopRef.current = el.scrollTop;
  }, [visible]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    scrollTopRef.current = event.currentTarget.scrollTop;
  }

  return (
    <div className="message-feed">
      <h2>Live messages</h2>

      <div className="message-feed-controls">
        <label>
          <input
            type="checkbox"
            checked={showAll || nodeTopics.length === 0}
            disabled={nodeTopics.length === 0}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          show everything
        </label>
        <span className="hint">
          {nodeTopics.length === 0
            ? "no node selected, or it has no static output:mqtt topics"
            : `filtering to ${nodeTopics.length} known topic(s)`}
        </span>
      </div>

      <div className="message-list" ref={listRef} onScroll={handleScroll}>
        {visible.length === 0 && (
          <div className="validation-empty">No messages yet.</div>
        )}

        {visible.map((message, index) => (
          <div className="message-entry" key={index}>
            <span className="topic">{message.topic}</span>
            <span className="payload">
              {typeof message.payload === "string"
                ? message.payload
                : JSON.stringify(message.payload)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
