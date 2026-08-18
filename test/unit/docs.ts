import { after, before, describe, it, mock } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { read as readConfigFile } from "node-yaml";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { globals, setGlobals, start } from "../../src/index.js";
import { validateConfig } from "../../src/util/validate.js";
import { formatConfigErrors } from "../../src/util/validate.js";
import { createMqttMock } from "../helpers.js";

interface Block {
  doc: string;
  index: number;
  language: string;
  body: string;
}

// Every fenced block in the docs, so a config example cannot drift away from
// what the runtime accepts without this failing.
function fencedBlocks(doc: string, text: string): Array<Block> {
  return [...text.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].map(
    (match, index) => ({
      doc,
      index,
      language: match[1],
      body: match[2],
    }),
  );
}

async function docFiles() {
  const reference = await readdir("docs/reference");

  return [
    "README.md",
    "cookbook.md",
    "sensors.md",
    "examples/examples.md",
    ...reference.map((name) => join("docs/reference", name)),
  ];
}

describe("the documentation's config examples", function () {
  let directory: string;
  let blocks: Array<Block>;

  before(async function () {
    directory = await mkdtemp(join(tmpdir(), "cutie-docs-"));
    blocks = [];

    for (const doc of await docFiles())
      blocks.push(
        ...fencedBlocks(doc, await readFile(doc, { encoding: "utf8" })),
      );
  });

  after(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  it("finds config blocks to check", function () {
    const candidates = blocks.filter((block) =>
      ["json", "yaml"].includes(block.language),
    );

    expect(
      candidates.length,
      "no json or yaml blocks in the docs",
    ).to.be.at.least(4);
  });

  it("validates every one of them", async function () {
    let checked = 0;

    for (const block of blocks) {
      if (!["json", "yaml"].includes(block.language)) continue;

      // Parsed with the same reader the runtime uses, via a file, so a block
      // that is valid here is valid as a config file.
      const path = join(
        directory,
        `${block.doc.replace(/[^A-Za-z0-9]/g, "-")}-${block.index}.${block.language === "json" ? "json" : "yaml"}`,
      );
      await writeFile(path, block.body);

      let parsed;
      try {
        parsed = await readConfigFile(path);
      } catch (error) {
        expect.fail(
          `${block.doc} block ${block.index} does not parse: ${(error as Error).message}`,
        );
      }

      // Only whole configs and the task-shaped blocks that illustrate a chain,
      // not the fragments that illustrate one option. A task-shaped block is
      // wrapped in a config so it goes through the same checks as the rest.
      if (parsed === null || typeof parsed !== "object") continue;

      const config =
        "tasks" in parsed || "connections" in parsed
          ? parsed
          : "steps" in parsed || "trigger" in parsed
            ? { tasks: { example: parsed } }
            : undefined;

      if (!config) continue;

      const errors = await validateConfig(config, { configPath: path });

      expect(
        errors,
        `${block.doc} block ${block.index}:\n${formatConfigErrors(errors)}`,
      ).to.deep.equal([]);
      checked++;
    }

    expect(checked, "no whole configs were checked").to.be.at.least(4);
  });
});

describe("the config npm start uses", function () {
  it("is the one the repo ships, and it validates clean", async function () {
    const packageJson = JSON.parse(
      await readFile("package.json", { encoding: "utf8" }),
    ) as { scripts: Record<string, string> };
    const match = /--config (\S+)/.exec(packageJson.scripts.start);

    expect(match, "npm start should name a config file").to.not.equal(null);

    const path = match![1];
    const config = await readConfigFile(path);

    expect(
      await validateConfig(config, { configPath: path }),
      `${path} does not validate`,
    ).to.deep.equal([]);
  });

  // The shipped config names a broker, and a real client would spend its whole
  // connect timeout reaching for one that is not there.
  before(function () {
    mock.module("mqtt", { defaultExport: createMqttMock().mqtt });
  });

  it("registers without a broker or any hardware", async function (context) {
    context.mock.method(console, "log", () => {});
    context.mock.timers.enable({ apis: ["setInterval"] });

    const result = await start({
      _: [],
      config: "./config/cutie.conf.yaml",
    } as never);

    try {
      expect(result.tasks.map((task) => task.name)).to.deep.equal([
        "heartbeat",
        "logs",
      ]);
      expect(result.tasks.every((task) => task.trigger?.enabled)).to.equal(
        true,
      );
    } finally {
      // Order matters. Disabling anything logs, and the shipped config has a
      // logs task publishing to the broker, so that task goes first and the
      // connections go last, with a tick in between for the chain it started.
      const [logs, rest] = [
        globals.tasks.filter((task) => task.name === "logs"),
        globals.tasks.filter((task) => task.name !== "logs"),
      ];

      for (const group of [logs, rest])
        await Promise.allSettled(group.map((task) => task.trigger?.disable()));

      await new Promise((resolve) => setImmediate(resolve));

      await Promise.allSettled(
        globals.connections.map((connection) => connection.disable()),
      );
      setGlobals({
        tasks: [],
        connections: [],
      } as never);
    }
  });
});
