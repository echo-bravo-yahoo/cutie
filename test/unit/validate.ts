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
    topics: { type: "array", description: "an array-typed option" },
  },
};

function stepConfig(step: Record<string, unknown>) {
  return { connections: [], tasks: { t: { steps: [step] } } };
}

const CONNECTION_NAME = "declared-connection";
const TASK_NAME = "declared-task";
const CALLER_NAME = "calling-task";

// The smallest value a schema will accept for an option, so a table-driven test
// can build a valid config for any module without hard-coding its options.
function placeholderFor(name: string, option: OptionSchema): unknown {
  if (name === "connectionName") return CONNECTION_NAME;
  // Only control:branch declares a `task` option, and like a connectionName it
  // is cross-checked against what the config declares, so "x" would not do.
  if (name === "task") return TASK_NAME;
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
    addListener(listener: unknown) {
      this.logListeners.push(listener);
    },
    removeListener(listener: unknown) {
      const index = this.logListeners.indexOf(listener);
      if (index !== -1) this.logListeners.splice(index, 1);
    },
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
          // Two spare tasks, because a step can refer to one either way: a
          // control:branch names TASK_NAME as its target, and CALLER_NAME
          // names `t` as its rescue so that a control:return in `t` has
          // somewhere to hand its value.
          const steps = {
            connections: [broker],
            tasks: {
              t: { steps: [module] },
              [TASK_NAME]: { steps: [] },
              [CALLER_NAME]: { rescue: "t", steps: [] },
            },
          };

          const config =
            kind === "connection"
              ? { connections: [{ ...module, name: "c" }], tasks: {} }
              : kind === "trigger"
                ? { connections: [broker], tasks: { t: { trigger: module } } }
                : steps;

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

    // Every step accepts `disabled`, but until it had a declared type nothing
    // checked it, so a truthy string turned a step off without saying so.
    it("type-checks a universal option", async function () {
      const errors = await check(
        stepConfig({ type: "read:constant", value: 1, disabled: "maybe" }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.t.steps[0].disabled",
          message: "expected boolean, found string",
        },
      ]);
    });

    it("accepts a universal option of the declared type", async function () {
      const errors = await check(
        stepConfig({
          type: "read:constant",
          value: 1,
          disabled: true,
          name: "a label",
        }),
      );

      expect(errors).to.deep.equal([]);
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

  describe("a rescue", function () {
    function tasks(entries: Record<string, unknown>) {
      return { connections: [], tasks: entries };
    }

    const STEP = { type: "read:constant", value: 1 };

    it("accepts a step naming a declared task", async function () {
      const errors = await check(
        tasks({
          weather: { rescue: "on-failure", steps: [STEP] },
          "on-failure": { steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([]);
    });

    it("reports a step naming a task the config does not declare", async function () {
      const errors = await check(
        tasks({ weather: { steps: [{ ...STEP, rescue: "absent" }] } }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.steps[0].rescue",
          message: 'no task named "absent" is declared',
        },
      ]);
    });

    // A warning rather than an error, as a disabled connection is: the task
    // exists, and turning it back on is one line away.
    it("warns about a rescue that is declared but disabled", async function () {
      const errors = await check(
        tasks({
          weather: { rescue: "on-failure", steps: [STEP] },
          "on-failure": { disabled: true, steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "warning",
          path: "tasks.weather.rescue",
          message: 'task "on-failure" is declared but disabled',
        },
      ]);
    });

    it("reports a rescue that leads back to the task it rescues", async function () {
      const errors = await check(
        tasks({
          weather: { rescue: "on-failure", steps: [STEP] },
          "on-failure": { rescue: "weather", steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.rescue",
          message: 'rescue "on-failure" leads back to task "weather"',
        },
        {
          severity: "error",
          path: "tasks.on-failure.rescue",
          message: 'rescue "weather" leads back to task "on-failure"',
        },
      ]);
    });

    it("reports a task that rescues itself", async function () {
      const errors = await check(
        tasks({ weather: { steps: [{ ...STEP, rescue: "weather" }] } }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.steps[0].rescue",
          message: 'rescue "weather" leads back to task "weather"',
        },
      ]);
    });

    it("accepts a chain of rescues that does not close", async function () {
      const errors = await check(
        tasks({
          weather: { rescue: "first", steps: [STEP] },
          first: { rescue: "second", steps: [STEP] },
          second: { steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([]);
    });

    it("reports a non-string rescue once", async function () {
      const errors = await check(tasks({ weather: { rescue: 5, steps: [] } }));

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.rescue",
          message: "expected string, found number",
        },
      ]);
    });
  });

  describe("a branch", function () {
    function tasks(entries: Record<string, unknown>) {
      return { connections: [], tasks: entries };
    }

    const STEP = { type: "read:constant", value: 1 };

    function branchTo(task: string) {
      return { type: "control:branch", task };
    }

    it("accepts a step naming a declared task", async function () {
      const errors = await check(
        tasks({
          weather: { steps: [branchTo("alert")] },
          alert: { steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([]);
    });

    it("reports a branch naming a task the config does not declare", async function () {
      const errors = await check(
        tasks({ weather: { steps: [branchTo("absent")] } }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.steps[0].task",
          message: 'no task named "absent" is declared',
        },
      ]);
    });

    it("warns about a target that is declared but disabled", async function () {
      const errors = await check(
        tasks({
          weather: { steps: [branchTo("alert")] },
          alert: { disabled: true, steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "warning",
          path: "tasks.weather.steps[0].task",
          message: 'task "alert" is declared but disabled',
        },
      ]);
    });

    it("reports a branch that leads back to the task it branches from", async function () {
      const errors = await check(
        tasks({
          weather: { steps: [branchTo("alert")] },
          alert: { steps: [branchTo("weather")] },
        }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.steps[0].task",
          message: 'branch "alert" leads back to task "weather"',
        },
        {
          severity: "error",
          path: "tasks.alert.steps[0].task",
          message: 'branch "weather" leads back to task "alert"',
        },
      ]);
    });

    // Both kinds of reference share one graph, so neither can be used to hide
    // half of a loop from the check the other one gets.
    it("reports a loop closed by one branch and one rescue", async function () {
      const errors = await check(
        tasks({
          weather: { steps: [branchTo("alert")] },
          alert: { rescue: "weather", steps: [STEP] },
        }),
      );

      expect(errors).to.deep.equal([
        {
          severity: "error",
          path: "tasks.weather.steps[0].task",
          message: 'branch "alert" leads back to task "weather"',
        },
        {
          severity: "error",
          path: "tasks.alert.rescue",
          message: 'rescue "weather" leads back to task "alert"',
        },
      ]);
    });
  });

  describe("a control:return", function () {
    function tasks(entries: Record<string, unknown>) {
      return { connections: [], tasks: entries };
    }

    const RETURNS = { type: "control:return", value: 1 };
    const STEP = { type: "read:constant", value: 1 };

    it("is reported when nothing can invoke the task holding it", async function () {
      const errors = await check(tasks({ weather: { steps: [RETURNS] } }));

      expect(errors).to.deep.equal([
        {
          severity: "warning",
          path: "tasks.weather.steps[0]",
          message:
            'nothing invokes task "weather", so this control:return hands its value nowhere',
        },
      ]);
    });

    it("is accepted once a rescue names the task", async function () {
      const errors = await check(
        tasks({
          weather: { rescue: "last-resort", steps: [STEP] },
          "last-resort": { steps: [RETURNS] },
        }),
      );

      expect(errors).to.deep.equal([]);
    });

    // Checked after every task has been read, so a branch further down the
    // file still counts.
    it("is accepted once a branch declared later names the task", async function () {
      const errors = await check(
        tasks({
          "last-resort": { steps: [RETURNS] },
          weather: {
            steps: [{ type: "control:branch", task: "last-resort" }],
          },
        }),
      );

      expect(errors).to.deep.equal([]);
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
    addListener(listener: unknown) {
      this.logListeners.push(listener);
    },
    removeListener(listener: unknown) {
      const index = this.logListeners.indexOf(listener);
      if (index !== -1) this.logListeners.splice(index, 1);
    },
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

      // The connection is named, and named as the kind it is: only
      // connection:mqtt implements ConfigProvider, so this is refused before
      // any fetch is attempted rather than throwing from a stub.
      await expect(fetchConfig(path)).to.be.rejectedWith(
        /Could not fetch the remote config .*Connection "influx" is a "connection:influxdb", which cannot serve a config.*could not read the cached copy at/s,
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
        /Could not fetch the remote config .*which cannot serve a config.*is not valid JSON/s,
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
    addListener(listener: unknown) {
      this.logListeners.push(listener);
    },
    removeListener(listener: unknown) {
      const index = this.logListeners.indexOf(listener);
      if (index !== -1) this.logListeners.splice(index, 1);
    },
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
    addListener(listener: unknown) {
      this.logListeners.push(listener);
    },
    removeListener(listener: unknown) {
      const index = this.logListeners.indexOf(listener);
      if (index !== -1) this.logListeners.splice(index, 1);
    },
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

  // The window that lets a pre-listener failure still be routed is unbounded,
  // so a config with no trigger:logs task must not leave it open for the life
  // of the process.
  it("closes the pre-listener log window once registration is over", async function (context) {
    context.mock.method(console, "log", () => {});
    const path = join(directory, "no-logs-task.conf.json");
    await writeFile(
      path,
      JSON.stringify({
        tasks: { quiet: { steps: [{ type: "output:console" }] } },
      }),
    );

    const result = await start({ _: [], config: path } as never);
    result.logger.emit("a line with nowhere to go", "info", "core.test");

    // Registering a listener afterwards is handed nothing, because nothing
    // was held.
    const listening = new Task(
      {
        trigger: {
          type: "trigger:logs",
          filters: ["core.test"],
          minVerbosity: "trace",
        },
        steps: [],
      } as never,
      "too late",
    );
    await listening.register();

    expect(listening.messagesHandled).to.equal(0);
    await listening.trigger?.disable();
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
