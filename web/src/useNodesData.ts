import { useEffect, useState } from "react";

import { fetchNodes } from "./api";
import { NodesResponse } from "./types";

export function useNodesData() {
  const [nodes, setNodes] = useState<NodesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetchNodes()
      .then((result) => {
        if (active) setNodes(result);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(String(error));
      });

    return () => {
      active = false;
    };
  }, []);

  return { nodes, loadError };
}
