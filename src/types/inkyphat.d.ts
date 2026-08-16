// inkyphat ships no type declarations and names no "types" entry in its
// package.json, so a deep import of one of its internals gives TypeScript
// nothing to resolve and trips noImplicitAny.
//
// The subpath is declared without a shape deliberately. Writing one here would
// be asserting a contract the package does not actually publish, and it would
// then drift silently the first time the package changed.
declare module "inkyphat/lib/inkyphat-utils.js";
declare module "inkyphat/lib/inkyphat-renderer-v2.js";
