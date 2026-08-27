import { useEffect, useState } from "react";

import Board from "./Board";
import { parseNodeNameFromPath, pathForNode } from "./router";
import { useNodesData } from "./useNodesData";

export default function App() {
  const { nodes, loadError } = useNodesData();
  const [nodeName, setNodeName] = useState<string | null>(() =>
    parseNodeNameFromPath(location.pathname),
  );

  useEffect(() => {
    function handlePopState() {
      setNodeName(parseNodeNameFromPath(location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigateTo(name: string | null) {
    const path = pathForNode(name);
    if (location.pathname !== path) history.pushState(null, "", path);
    setNodeName(name);
  }

  const nodeNames = nodes ? Object.keys(nodes).sort() : [];
  const activeName = nodeName && nodeNames.includes(nodeName) ? nodeName : null;

  // A stale deep link (the URL names a node that no longer exists) redirects
  // home once nodes have actually loaded, rather than showing a broken
  // board -- checked against `nodes` itself, not the `nodeNames` array
  // derived from it each render, so this does not loop.
  useEffect(() => {
    if (nodes && nodeName && !Object.keys(nodes).includes(nodeName))
      navigateTo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, nodeName]);

  const config = activeName && nodes ? nodes[activeName] : null;

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigateTo(null);
          }}
        >
          cutie
        </a>
        {nodes && nodeNames.length > 0 && (
          <select
            value={activeName ?? ""}
            onChange={(event) => navigateTo(event.target.value || null)}
          >
            <option value="" disabled>
              Select a node...
            </option>
            {nodeNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </header>

      {loadError ? (
        <div className="empty-state">
          Could not reach the cutie web UI backend: {loadError}
        </div>
      ) : !nodes ? (
        <div className="empty-state">Loading...</div>
      ) : !activeName || !config ? (
        <div className="empty-state">
          {nodeNames.length === 0
            ? "No nodes found. Any hostname with a retained message on cutie/config/<name> shows up here."
            : "Select a node to see its shape."}
        </div>
      ) : (
        <Board nodeName={activeName} config={config} />
      )}
    </div>
  );
}
