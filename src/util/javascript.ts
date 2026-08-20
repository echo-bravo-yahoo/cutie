import * as vm from "node:vm";

import { currentMessageContext } from "./TaskModule.js";
import { Message } from "./type-helpers.js";

// The interpolation namespace, minus globals, as real objects rather than text
// spliced into the source. Every one is a free reference; globals is left out
// because it needs a redact() pass per message and nothing configures against
// it from JS.
const PARAMS = ["message", "stash", "error", "task", "module", "env"] as const;

export type CompiledScript = (
  message: Message,
  module: unknown,
  task: unknown,
) => Message;

// Compiles configured source once and hands back something to call per message.
// Building the context and recompiling per message cost 341us a message, nearly
// all of it in vm.createContext standing up a whole new V8 realm; calling an
// already-compiled function costs 0.04us.
//
// node:vm is not a security boundary -- `message.constructor.constructor` still
// reaches this realm -- but it keeps require, process, and fetch from simply
// being in scope. A config has always been trusted code: transform:shell runs
// whatever it is given.
export function compileScript(source: string, type: string): CompiledScript {
  // One context per compiled script, not one shared: an undeclared assignment
  // (`foo = 1`) lands on the sandbox global, and two JS steps must not see
  // each other's.
  const sandbox = vm.createContext({});
  let compiled;

  try {
    compiled = vm.compileFunction(source, [...PARAMS], {
      parsingContext: sandbox,
    });
  } catch (error) {
    throw new Error(`"${type}" could not compile: ${(error as Error).message}`);
  }

  return (message, module, task) => {
    const context = currentMessageContext();

    return compiled(
      message,
      context?.stash ?? {},
      context?.error,
      task,
      module,
      process.env,
    );
  };
}
