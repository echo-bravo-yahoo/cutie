// Records that it was imported, so a test can prove a traversal-shaped module
// type never reaches a dynamic import.
globalThis.__cutieTattleImports = (globalThis.__cutieTattleImports ?? 0) + 1;

export const schema = {
  type: "read:tattle",
  description: "never loaded on purpose",
  options: {},
};

export default class Tattle {}
