import parser, { Arguments } from "yargs-parser";

// type-only, so this does not pull the triggers directory into the CLI's
// module graph
import type { Verbosity } from "../triggers/logs.js";

export interface CLIArgs extends Arguments {
  config: string;
  logLevel?: Verbosity;
}

export type ParserDefaults = Pick<
  Required<parser.Options>,
  "string" | "default"
> &
  parser.Options;

export function mergeParserArgs(
  defaults: ParserDefaults,
  overrides: parser.Options,
) {
  const results = defaults;
  if (overrides.string)
    defaults.string = [...defaults.string, ...overrides.string];
  return results;
}

export const LOG_LEVELS: ReadonlyArray<Verbosity> = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

export const parserDefaults: ParserDefaults = {
  string: ["config", "log-level"],
  default: {
    config: `${process.cwd()}/cutie.conf.yaml`,
  },
};

interface Flag {
  name: string;
  // The value placeholder shown in help text; a boolean flag has none.
  value?: string;
  description: string;
}

const GLOBAL_FLAGS: ReadonlyArray<Flag> = [
  {
    name: "config",
    value: "<path>",
    description: "config file to use (default: ./cutie.conf.yaml)",
  },
  {
    name: "log-level",
    value: "<level>",
    description: `lowest level to log; one of ${LOG_LEVELS.join(", ")} (default: debug)`,
  },
  { name: "help", description: "show this message" },
  { name: "version", description: "show the installed version" },
];

const REMOTE_CONFIG_FLAGS: ReadonlyArray<Flag> = [
  {
    name: "connectionName",
    value: "<name>",
    description: "name of the connection in the config file to use",
  },
  {
    name: "path",
    value: "<path>",
    description: "directory of config files, or one file when --node is given",
  },
  {
    name: "node",
    value: "<name>",
    description: "act on this node only; omit to act on every node",
  },
  {
    name: "topic",
    value: "<topic>",
    description: "override the connection's configured config topic",
  },
];

interface Subcommand {
  summary: string;
  flags: ReadonlyArray<Flag>;
}

export const SUBCOMMANDS: Record<string, Subcommand> = {
  start: { summary: "run the tasks in the config file (default)", flags: [] },
  init: {
    summary: "write a starter config file to the current directory",
    flags: [],
  },
  validate: {
    summary: "check the config file and report every problem found",
    flags: [],
  },
  upload: {
    summary: "publish local config files to a connection",
    flags: REMOTE_CONFIG_FLAGS,
  },
  download: {
    summary: "fetch config files from a connection",
    flags: REMOTE_CONFIG_FLAGS,
  },
};

function flagLines(flags: ReadonlyArray<Flag>) {
  const rendered = flags.map((flag) => ({
    left: `  --${flag.name}${flag.value ? ` ${flag.value}` : ""}`,
    right: flag.description,
  }));
  const width = Math.max(...rendered.map((entry) => entry.left.length));

  return rendered.map(
    (entry) => `${entry.left.padEnd(width + 3)}${entry.right}`,
  );
}

export function usageFor(subcommand?: string): string {
  if (subcommand === undefined || !SUBCOMMANDS[subcommand]) {
    const commands = Object.entries(SUBCOMMANDS).map(
      ([name, entry]) => `  ${name.padEnd(11)}${entry.summary}`,
    );

    return [
      "cutie -- automate MQTT interactions",
      "",
      "Usage: cutie [command] [options]",
      "",
      "Commands:",
      ...commands,
      "",
      "Options:",
      ...flagLines(GLOBAL_FLAGS),
    ].join("\n");
  }

  const entry = SUBCOMMANDS[subcommand];

  return [
    `cutie ${subcommand} -- ${entry.summary}`,
    "",
    `Usage: cutie ${subcommand} [options]`,
    "",
    "Options:",
    ...flagLines([...entry.flags, ...GLOBAL_FLAGS]),
  ].join("\n");
}

function toCamelCase(name: string) {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function toKebabCase(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// yargs-parser's camel-case expansion means one declared flag arrives under
// more than one key, and a user may type either spelling.
export function flagNames(subcommand?: string): Array<string> {
  const flags = [
    ...GLOBAL_FLAGS,
    ...(subcommand && SUBCOMMANDS[subcommand]
      ? SUBCOMMANDS[subcommand].flags
      : []),
  ];

  return [...new Set(flags.map((flag) => flag.name))];
}

function acceptedKeys(subcommand?: string): Set<string> {
  const keys = new Set<string>(["_", "$0"]);

  for (const name of flagNames(subcommand)) {
    keys.add(name);
    keys.add(toCamelCase(name));
    keys.add(toKebabCase(name));
  }

  return keys;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_value, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length];
}

export function suggestFlag(
  unknown: string,
  subcommand?: string,
): string | undefined {
  const candidates = flagNames(subcommand).map((name) => ({
    name,
    distance: editDistance(unknown.toLowerCase(), name.toLowerCase()),
  }));
  const best = candidates.sort((a, b) => a.distance - b.distance)[0];

  return best && best.distance <= 3 ? best.name : undefined;
}

// yargs-parser has no strict mode of its own, so accept only declared flags
// and report the rest.
export function unknownFlagErrors(
  argv: Arguments,
  subcommand?: string,
): Array<string> {
  const accepted = acceptedKeys(subcommand);

  return Object.keys(argv)
    .filter((key) => !accepted.has(key))
    .map((key) => {
      const suggestion = suggestFlag(key, subcommand);

      return `Unknown option "--${key}".${suggestion ? ` Did you mean "--${suggestion}"?` : ""}`;
    });
}
