const NODE_PATH_PATTERN = /^\/node\/([^/]+)\/?$/;

// This app's entire route surface is two shapes: "/" (home, no node
// selected) and "/node/<name>" (one node's editor) -- small enough that
// pushState/popstate directly is simpler than pulling in a router library.
export function parseNodeNameFromPath(pathname: string): string | null {
  const match = NODE_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function pathForNode(name: string | null): string {
  return name ? `/node/${encodeURIComponent(name)}` : "/";
}
