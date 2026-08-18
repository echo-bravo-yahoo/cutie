import { after, before, describe, it, mock } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, globals, setGlobals, start } from "../../src/index.js";
import { main } from "../../src/cli-entrypoint.js";
import Constant from "../../src/reads/constant.js";
import {
  SUBCOMMANDS,
  parserDefaults,
  unknownFlagErrors,
  usageFor,
} from "../../src/util/cli.js";
import { fetchConfig } from "../../src/util/configs.js";
import { listModules, loadSchema } from "../../src/util/modules.js";
import {
  ModuleSchema,
  OptionSchema,
  registerSchema,
} from "../../src/util/schema.js";
import Task from "../../src/util/Task.js";
import { KINDS } from "../../src/util/type-helpers.js";
import {
  ConfigError,
  formatConfigErrors,
  validateConfig,
} from "../../src/util/validate.js";
import { taskDone } from "../helpers.js";

import parser from "yargs-parser";

const CONFIG_PATH = "/tmp/cutie.conf.json";

// The nine modules that used to supply their defaults from an
// addDefaultsToConfig override, which returned a new object and so broke the
// reference-identity lookup Step used to find its own position.
const MODULES_WITH_DEFAULTS = [
  "output:file",
  "output:nec",
  "output:switchbots",
  "output:thermal-printer",
  "read:file",
  "transform:prettify",
  "transform:uglify",
  "trigger:logs",
  "trigger:once",
];

function errorsAt(errors: Array<ConfigError>, path: string) {
  return errors.filter((entry) => entry.path === path);
}

async function check(config: unknown) {
  return validateConfig(config, { configPath: CONFIG_PATH });
}

// Swaps in a schema for the duration of a block and puts the module's real one
// back afterwards, so a synthetic schema cannot leak into another test.
async function withSchema<T>(
  schema: ModuleSchema,
  body: () => Promise<T>,
): Promise<T> {
  const original = await loadSchema(schema.type);
  registerSchema(schema);

  try {
    return await body();
  } finally {
    registerSchema(original);
  }
}

// Exercises one of every check in the wording table against a module that
// exists on disk; the Wave 1 stubs declare no options of their own.
const SYNTHETIC: ModuleSchema = {
  type: "read:constant",
  description: "a synthetic schema covering every option check",
  options: {
    label: { type: "string", description: "a required string", required: true },
    count: {
      type: "number",
      description: "a bounded integer",
      min: 1,
      max: 10,
      integer: true,
    },
    mode: {
      type: "string",
      description: "a closed set",
      enum: ["fast", "slow"],
    },
    greeting: {
      type: "string",
      description: "has a default",
      default: "hello",
    },
    topic: {
      type: "string",
      description: "the old name for topics",
      deprecated: { replacedBy: "topics" },
    },
    topics: { type: "array", description: "the new name" },
  },
};

function stepConfig(step: Record<string, unknown>) {
  return { connections: [], tasks: { t: { steps: [step] } } };
}

const CONNECTION_NAME = "declared-connection";

// The smallest value a schema will accept for an option, so a table-driven test
// can build a valid config for any module without hard-coding its options.
function placeholderFor(name: string, option: OptionSchema): unknown {
  if (name === "connectionName") return CONNECTION_NAME;
  if (option.enum?.length) return option.enum[0];

  switch (option.type) {
    case "string":
      return "x";
    case "number":
      return option.min ?? (option.max !== undefined ? option.max : 1);
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "x";
  }
}

async function minimalOptions(schema: ModuleSchema) {
  const options: Record<string, unknown> = {};

  for (const [name, option] of Object.entries(schema.options))
    if (option.required) options[name] = placeholderFor(name, option);

  return options;
}

describe("config validation", function () {
  const fakeLogger = {
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logListeners: [] as Array<unknown>,
    logger: { info: () => {}, debug: () => {}, child: () => fakeLogger },
  };

  before(function () {
    setGlobals({
      tasks: [],
      connections: [],
      version: "test",
      logger: fakeLogger,
      eventBus: undefined,
    } as unknown as Globals);
  });

  describe("every module on disk", function () {
    it("declares a schema that loads and names its own type", async function () {
      const modules = await listModules();

      for (const kind of KINDS) {
        for (const subKind of modules[kind]) {
          const type = `${kind}:${subKind}`;
          const schema = await loadSchema(type);

          expect(schema.type, type).to.equal(type);
          expect(schema.description, type).to.be.a("string");
          expect(schema.options, type).to.be.an("object");
        }
      }
    });

    // The gate that proves no module is still carrying a placeholder schema:
    // an unfinished one accepts every key and describes nothing.
    it("declares its options rather than accepting anything", async function () {
      const modules = await listModules();

      for (const kind of KINDS) {
        for (const subKind of modules[kind]) {
          const type = `${kind}:${subKind}`;
          const schema = await loadSchema(type);

          expect(
            schema.additionalOptions,
            `${type} still accepts undeclared options`,
          ).to.not.equal(true);
          expect(schema.description, type).to.not.equal("TODO");
          expect(schema.description.length, type).to.be.greaterThan(10);
        }
      }
    });

    it("declares options that never set both required and default", async function () {
      const modules = await listModules();

      for (const kind of KINDS) {
        for (const subKind of modules[kind]) {
          const type = `${kind}:${subKind}`;
          const schema = await loadSchema(type);

          for (const [name, option] of Object.entries(schema.options)) {
            const where = `${type}.${name}`;
            expect(
              !(option.required && option.default !== undefined),
              `${where} sets both required and default`,
            ).to.equal(true);
            expect(option.description, where).to.be.a("string");
          }
        }
      }
    });

    it("validates clean in a minimal config", async function () {
      const modules = await listModules();
      // A step naming a connection needs one declared, and its options come
      // from the connection's own schema, so build that the same way.
      const brokerSchema = await loadSchema("connection:mqtt");
      const broker = {
        type: "connection:mqtt",
        name: CONNECTION_NAME,
        ...(await minimalOptions(brokerSchema)),
      };

      for (const kind of KINDS) {
        for (const subKind of modules[kind]) {
          const type = `${kind}:${subKind}`;
          const module = {
            type,
            ...(await minimalOptions(await loadSchema(type))),
          };
          const config =
            kind === "connection"
              ? { connections: [{ ...module, name: "c" }], tasks: {} }
              : kind === "trigger"
                ? { connections: [broker], tasks: { t: { trigger: module } } }
                : { connections: [broker], tasks: { t: { steps: [module] } } };

          expect(await check(config), type).to.deep.equal([]);
        }
      }
    });
  });

  describe("the whole document", function () {
    it("rejects an empty file, naming the resolved path", async function () {
      expect(await check(undefined)).to.deep.equal([
        {
          severity: "error",
          path: "",
          message: `expected object, found undefined in "${CONFIG_PATH}"`,
        },
      ]);
    });

    it("rejects an object with no keys, naming the resolved path", async function () {
      expect(await check({})).to.deep.equal([
        {
          severity: "error",
          path: "",
          message: `no configuration found in "${CONFIG_PATH}"`,
        },
      ]);
    });

    it("rejects an array top level, naming the resolved path", async function () {
      expect(await check([])).to.deep.equal([
        {
          severity: "error",
          path: "",
          message: `expected object, found array in "${CONFIG_PATH}"`,
        },
      ]);
    });

    it("rejects a string top level, naming the resolved path", async function () {
      expect(await check("tasks")).to.deep.equal([
        {
          severity: "error",
          path: "",
          message: `expected object, found string in "${CONFIG_PATH}"`,
        },
      ]);
    });

    it("rejects tasks as an array", async function () {
      const errors = await check({ tasks: [{ steps: [] }] });

      expect(errorsAt(errors, "tasks")).to.deep.equal([
        {
          severity: "error",
          path: "tasks",
          message: "expected object, found array",
        },
      ]);
    });

    it("accepts a config with no connections key", async function () {
      expect(
        await check({ tasks: { t: { steps: [{ type: "output:console" }] } } }),
      ).to.deep.equal([]);
    });

    it("accepts a task with a trigger and no steps", async function () {
      expect(
        await check({ tasks: { t: { trigger: { type: "trigger:once" } } } }),
      ).to.deep.equal([]);
    });

    it("reports every independent error, not just the first", async function () {
      const errors = await check({
        connections: [{ type: "connection:mqtt", endpoint: "mqtt://x" }],
        tasks: {
          a: { steps: [{ type: "read:nonexistent" }] },
          b: {
            steps: [
              { type: "output:mqtt", connectionName: "missing", topics: ["t"] },
            ],
          },
        },
      });

      expect(errors.map((entry) => entry.path).sort()).to.deep.equal([
        "connections[0].name",
        "tasks.a.steps[0].type",
        "tasks.b.steps[0].connectionName",
      ]);
    });
  });

  describe("a module's type", function () {
    it("is required", async function () {
      expect(
        errorsAt(await check(stepConfig({})), "tasks.t.steps[0].type"),
      ).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].type",
          message: "missing required option; expected string",
        },
      ]);
    });

    it("rejects a malformed type", async function () {
      const errors = await check(stepConfig({ type: "nonsense" }));

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].type",
          message: 'expected a "kind:subKind" type, found "nonsense"',
        },
      ]);
    });

    it("rejects an unknown kind, listing the kinds", async function () {
      const errors = await check(stepConfig({ type: "sensor:bme280" }));

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].type",
          message: `unknown kind "sensor"; expected one of: ${[...KINDS].sort().join(", ")}`,
        },
      ]);
    });

    it("rejects an unknown subKind, listing that kind's modules", async function () {
      const reads = (await listModules()).read;
      const errors = await check(stepConfig({ type: "read:barometer" }));

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].type",
          message: `unknown read type "barometer"; expected one of: ${reads.join(", ")}`,
        },
      ]);
    });

    it("rejects a traversal without importing anything", async function () {
      const before = globalThis.__cutieTattleImports ?? 0;
      const errors = await check(
        stepConfig({ type: "read:../../test/unit/fixtures/tattle" }),
      );

      expect(errors[0].message).to.match(/^unknown read type /);
      expect(globalThis.__cutieTattleImports ?? 0).to.equal(before);
    });

    it("rejects a trigger used as a step", async function () {
      const errors = await check(stepConfig({ type: "trigger:once" }));

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].type",
          message: 'expected a step, found "trigger:once"',
        },
      ]);
    });

    it("rejects a step used as a trigger", async function () {
      const errors = await check({
        tasks: { t: { trigger: { type: "output:console" } } },
      });

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.trigger.type",
          message: 'expected a trigger, found "output:console"',
        },
      ]);
    });
  });

  describe("a module's options", function () {
    it("reports a missing required option", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(stepConfig({ type: "read:constant" }));

        expect(errorsAt(errors, "tasks.t.steps[0].label")).to.deep.equal([
          {
            severity: "error",
            path: "tasks.t.steps[0].label",
            message: "missing required option; expected string",
          },
        ]);
      });
    });

    it("reports a wrong type", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({ type: "read:constant", label: 5 }),
        );

        expect(errors).to.deep.equal([
          {
            severity: "error",
            path: "tasks.t.steps[0].label",
            message: "expected string, found number",
          },
        ]);
      });
    });

    it("reports a value outside an enum", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({ type: "read:constant", label: "x", mode: "medium" }),
        );

        expect(errors).to.deep.equal([
          {
            severity: "error",
            path: "tasks.t.steps[0].mode",
            message: '"medium" is not one of: fast, slow',
          },
        ]);
      });
    });

    it("reports a number out of range", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({ type: "read:constant", label: "x", count: 42 }),
        );

        expect(errors).to.deep.equal([
          {
            severity: "error",
            path: "tasks.t.steps[0].count",
            message: "42 is out of range; expected 1 to 10",
          },
        ]);
      });
    });

    it("reports a non-integer", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({ type: "read:constant", label: "x", count: 1.5 }),
        );

        expect(errors).to.deep.equal([
          {
            severity: "error",
            path: "tasks.t.steps[0].count",
            message: "1.5 is not an integer",
          },
        ]);
      });
    });

    it("warns about an unknown option", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({ type: "read:constant", label: "x", nonsense: true }),
        );

        expect(errors).to.deep.equal([
          {
            severity: "warning",
            path: "tasks.t.steps[0].nonsense",
            message: "unknown option for read:constant",
          },
        ]);
      });
    });

    it("warns about a deprecated option and accepts it", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({ type: "read:constant", label: "x", topic: "a/b" }),
        );

        expect(errors).to.deep.equal([
          {
            severity: "warning",
            path: "tasks.t.steps[0].topic",
            message: 'deprecated; use "topics" instead',
          },
        ]);
      });
    });

    it("rejects a deprecated option alongside its replacement", async function () {
      await withSchema(SYNTHETIC, async function () {
        const errors = await check(
          stepConfig({
            type: "read:constant",
            label: "x",
            topic: "a/b",
            topics: ["a/b"],
          }),
        );

        expect(errorsAt(errors, "tasks.t.steps[0].topic")).to.deep.include({
          severity: "error",
          path: "tasks.t.steps[0].topic",
          message: 'cannot be combined with "topics"',
        });
      });
    });

    it("resolves a connectionName against the declared connections", async function () {
      const declared = {
        connections: [
          { type: "connection:mqtt", name: "broker", endpoint: "mqtt://x" },
        ],
        tasks: {
          t: {
            steps: [
              { type: "output:mqtt", connectionName: "broker", topics: ["a"] },
            ],
          },
        },
      };

      expect(await check(declared)).to.deep.equal([]);

      const missing = { ...declared, connections: [] };

      expect(await check(missing)).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].connectionName",
          message: 'no connection named "broker" is declared',
        },
      ]);
    });
  });

  describe("the rendered report", function () {
    it("puts errors before warnings and ends with a count", function () {
      const rendered = formatConfigErrors([
        {
          severity: "warning",
          path: "tasks.t.steps[0].x",
          message: "a warning",
        },
        { severity: "error", path: "tasks.t.steps[0].y", message: "an error" },
      ]);

      expect(rendered.split("\n")).to.deep.equal([
        "error tasks.t.steps[0].y: an error",
        "warning tasks.t.steps[0].x: a warning",
        "Found 1 error and 1 warning.",
      ]);
    });
  });
});

describe("reading the config file", function () {
  const logged: Array<string> = [];
  const fakeLogger = {
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string) => logged.push(message),
    logListeners: [] as Array<unknown>,
    logger: { info: () => {}, debug: () => {}, child: () => fakeLogger },
  };
  let directory: string;

  before(async function () {
    directory = await mkdtemp(join(tmpdir(), "cutie-configs-"));
    setGlobals({
      tasks: [],
      connections: [],
      version: "test",
      logger: fakeLogger,
      eventBus: undefined,
    } as unknown as Globals);
  });

  after(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(name: string, contents: string) {
    const path = join(directory, name);
    await writeFile(path, contents);

    return path;
  }

  it("names the resolved path when the file is missing", async function () {
    const path = join(directory, "absent.conf.json");

    await expect(fetchConfig(path)).to.be.rejectedWith(
      `Could not read the config at "${normalize(path)}"`,
    );
  });

  it("names the path, line, and column of a YAML syntax error", async function () {
    const path = await writeConfig("broken.yaml", "a: 1\nb: [1, 2\nc: 3\n");

    await expect(fetchConfig(path)).to.be.rejectedWith(
      new RegExp(
        `Could not read the config at "${normalize(path).replace(/[\\/]/g, "[\\\\/]")}".*at line 3, column 1`,
      ),
    );
  });

  describe("falling back to the cache", function () {
    // The InfluxDB connection refuses to serve config, which is a remote-fetch
    // failure with no broker involved.
    const remoteConfig = {
      configProvider: { connectionName: "influx" },
      connections: [
        {
          type: "connection:influxdb",
          name: "influx",
          url: "http://127.0.0.1:8086",
        },
      ],
      tasks: {},
    };

    it("names both failures when the cache is missing", async function () {
      const path = await writeConfig(
        "no-cache.conf.json",
        JSON.stringify(remoteConfig),
      );

      await expect(fetchConfig(path)).to.be.rejectedWith(
        /Could not fetch the remote config .*cannot be used to fetch config.*could not read the cached copy at/s,
      );
      globals.connections = [];
    });

    it("names both failures when the cache is not valid JSON", async function () {
      const path = await writeConfig(
        "bad-cache.conf.json",
        JSON.stringify(remoteConfig),
      );
      await writeConfig("bad-cache.conf.json.cache.json", "not json at all");

      await expect(fetchConfig(path)).to.be.rejectedWith(
        /Could not fetch the remote config .*cannot be used to fetch config.*is not valid JSON/s,
      );
      globals.connections = [];
    });

    it("uses a readable cache and says so", async function () {
      const path = await writeConfig(
        "good-cache.conf.json",
        JSON.stringify(remoteConfig),
      );
      await writeConfig(
        "good-cache.conf.json.cache.json",
        JSON.stringify({ connections: [], tasks: { cached: { steps: [] } } }),
      );
      logged.length = 0;

      const config = await fetchConfig(path);

      expect(Object.keys(config.tasks ?? {})).to.deep.equal(["cached"]);
      expect(logged.join("\n")).to.match(/FALLING BACK to the cached copy/);
      globals.connections = [];
    });
  });
});

describe("a step's log topic", function () {
  const fakeLogger = {
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logListeners: [] as Array<unknown>,
    logger: { info: () => {}, debug: () => {}, child: () => fakeLogger },
  };

  before(function () {
    setGlobals({
      tasks: [],
      connections: [],
      version: "test",
      logger: fakeLogger,
      eventBus: undefined,
    } as unknown as Globals);
  });

  it("carries the real step index for every module that declares defaults", async function () {
    for (const type of MODULES_WITH_DEFAULTS) {
      const isTrigger = type.startsWith("trigger:");
      const task = new Task({ steps: [] }, "topics");
      const config = {
        type,
        filters: ["*"],
        path: "/tmp/x",
        devicePath: "/tmp/x",
      };
      const step = await task.importStep(
        config as never,
        isTrigger ? undefined : 2,
      );

      expect(step.logPrefix, type).to.equal(
        `core.runtime.tasks.topics.${isTrigger ? "trigger" : "steps.2"}`,
      );
      expect(step.logPrefix, type).to.not.match(/-1/);
    }
  });

  it("comes out right through the real registration path", async function () {
    const task = new Task(
      {
        trigger: { type: "trigger:logs", filters: ["nothing"] } as never,
        steps: [
          { type: "read:constant", value: 1 } as never,
          { type: "transform:prettify" } as never,
          { type: "output:stash", key: "k", value: "v" } as never,
        ],
      },
      "registered",
    );

    await task.register();

    expect(task.trigger?.logPrefix).to.equal(
      "core.runtime.tasks.registered.trigger",
    );
    expect(task.steps.map((step) => step.logPrefix)).to.deep.equal([
      "core.runtime.tasks.registered.steps.0",
      "core.runtime.tasks.registered.steps.1",
      "core.runtime.tasks.registered.steps.2",
    ]);

    await task.trigger?.disable();
  });
});

describe("schema defaults", function () {
  const fakeLogger = {
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logListeners: [] as Array<unknown>,
    logger: { info: () => {}, debug: () => {}, child: () => fakeLogger },
  };

  before(function () {
    setGlobals({
      tasks: [],
      connections: [],
      version: "test",
      logger: fakeLogger,
      eventBus: undefined,
    } as unknown as Globals);
  });

  it("fills a declared default and lets an explicit value win", async function () {
    await withSchema(SYNTHETIC, async function () {
      const task = new Task({ steps: [] }, "defaults");

      const filled = new Constant({ type: "read:constant" } as never, task, 0);
      expect((filled.config as Record<string, unknown>).greeting).to.equal(
        "hello",
      );

      const explicit = new Constant(
        { type: "read:constant", greeting: "hi" } as never,
        task,
        0,
      );
      expect((explicit.config as Record<string, unknown>).greeting).to.equal(
        "hi",
      );
    });
  });

  it("moves a deprecated option onto its replacement", async function () {
    await withSchema(SYNTHETIC, async function () {
      const task = new Task({ steps: [] }, "deprecated");
      const step = new Constant(
        { type: "read:constant", topic: "a/b" } as never,
        task,
        0,
      );
      const config = step.config as Record<string, unknown>;

      expect(config.topics).to.deep.equal(["a/b"]);
      expect(config.topic).to.equal(undefined);
    });
  });
});

describe("the CLI", function () {
  let directory: string;
  let cleanConfig: string;
  let dirtyConfig: string;

  before(async function () {
    directory = await mkdtemp(join(tmpdir(), "cutie-cli-"));
    cleanConfig = join(directory, "clean.conf.json");
    dirtyConfig = join(directory, "dirty.conf.json");

    await writeFile(
      cleanConfig,
      JSON.stringify({
        connections: [],
        tasks: { hello: { steps: [{ type: "output:console" }] } },
      }),
    );
    await writeFile(
      dirtyConfig,
      JSON.stringify({
        connections: [
          { type: "connection:mqtt", name: "m", endpoint: "mqtt://127.0.0.1" },
        ],
        tasks: { hello: { steps: [{ type: "output:nonsense" }] } },
      }),
    );
  });

  after(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  it("validates a clean config with nothing on stderr", async function (context) {
    const error = context.mock.method(console, "error", () => {});
    const log = context.mock.method(console, "log", () => {});

    expect(await main(["validate", "--config", cleanConfig])).to.equal(0);
    expect(error.mock.callCount()).to.equal(0);
    expect(log.mock.calls[0].arguments[0]).to.match(/is valid\./);
  });

  it("exits non-zero on a dirty config and reports it", async function (context) {
    const error = context.mock.method(console, "error", () => {});

    expect(await main(["validate", "--config", dirtyConfig])).to.equal(1);
    expect(error.mock.calls[0].arguments[0]).to.match(
      /error tasks\.hello\.steps\[0\]\.type: unknown output type/,
    );
  });

  it("refuses to start a dirty config and registers no connection", async function (context) {
    context.mock.method(console, "error", () => {});

    await expect(
      start({ _: [], config: dirtyConfig } as never),
    ).to.be.rejectedWith(/Refusing to start/);
    expect(globals.connections).to.deep.equal([]);
  });

  it("rejects an unknown flag and suggests the closest one", async function (context) {
    const error = context.mock.method(console, "error", () => {});

    expect(await main(["--confg", "x.yaml"])).to.equal(1);
    expect(error.mock.calls[0].arguments[0]).to.match(
      /Unknown option "--confg"\. Did you mean "--config"\?/,
    );
  });

  it("rejects an unknown command", async function (context) {
    const error = context.mock.method(console, "error", () => {});

    expect(await main(["frobnicate"])).to.equal(1);
    expect(error.mock.calls[0].arguments[0]).to.match(
      /Unknown command "frobnicate"/,
    );
  });

  it("documents every command in the top-level help", async function (context) {
    const log = context.mock.method(console, "log", () => {});

    expect(await main(["--help"])).to.equal(0);

    const printed = log.mock.calls[0].arguments[0] as string;
    for (const name of Object.keys(SUBCOMMANDS))
      expect(printed, name).to.include(name);
  });

  it("prints upload's own four flags and registers no connection", async function (context) {
    const log = context.mock.method(console, "log", () => {});

    expect(await main(["upload", "--help"])).to.equal(0);

    const printed = log.mock.calls[0].arguments[0] as string;
    for (const flag of ["--connectionName", "--path", "--node", "--topic"])
      expect(printed, flag).to.include(flag);
    expect(globals.connections).to.deep.equal([]);
  });

  it("parses every flag its own help text names", function () {
    for (const subcommand of [undefined, ...Object.keys(SUBCOMMANDS)]) {
      const usage = usageFor(subcommand);
      const named = [...usage.matchAll(/^ {2}--([a-zA-Z-]+)/gm)].map(
        (match) => match[1],
      );

      expect(named.length, `${subcommand}`).to.be.greaterThan(0);

      for (const flag of named) {
        const args = [
          ...(subcommand ? [subcommand] : []),
          `--${flag}`,
          "value",
        ];
        const argv = parser(args, parserDefaults);

        expect(
          unknownFlagErrors(argv, subcommand),
          `${subcommand} --${flag}`,
        ).to.deep.equal([]);
      }
    }
  });
});

describe("registering a validated config", function () {
  let directory: string;

  before(async function () {
    directory = await mkdtemp(join(tmpdir(), "cutie-start-"));
  });

  after(async function () {
    await rm(directory, { recursive: true, force: true });
    mock.restoreAll();
  });

  it("names tasks after the keys of the tasks record", async function (context) {
    context.mock.method(console, "log", () => {});
    const path = join(directory, "named.conf.json");
    await writeFile(
      path,
      JSON.stringify({
        tasks: {
          first: { steps: [{ type: "output:console" }] },
          second: { steps: [{ type: "output:console" }] },
        },
      }),
    );

    const result = await start({ _: [], config: path } as never);

    expect(result.tasks.map((task) => task.name)).to.deep.equal([
      "first",
      "second",
    ]);
  });

  it("delivers a triggered message to endMessage when a task has no steps", async function () {
    const path = join(directory, "no-steps.conf.json");
    await writeFile(
      path,
      JSON.stringify({
        tasks: { ping: { trigger: { type: "trigger:once", message: "hi" } } },
      }),
    );

    const result = await start({ _: [], config: path } as never);
    const task = result.tasks[0];

    await taskDone(task, { timeout: 200 });

    expect(task.messagesHandled).to.equal(1);
    expect(task.steps).to.deep.equal([]);
  });
});
