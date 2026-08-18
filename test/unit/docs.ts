import { after, before, describe, it } from "node:test";
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

      // Only whole configs, not the fragments that illustrate one option.
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !("tasks" in parsed || "connections" in parsed)
      )
        continue;

      const errors = await validateConfig(parsed, { configPath: path });

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

  it("registers without a broker or any hardware", async function (context) {
    context.mock.method(console, "log", () => {});
    context.mock.timers.enable({ apis: ["setInterval"] });

    const result = await start({
      _: [],
      config: "./config/cutie.conf.json",
    } as never);

    try {
      expect(result.tasks.map((task) => task.name)).to.deep.equal(["hello"]);
      expect(result.tasks[0].trigger?.enabled).to.equal(true);
    } finally {
      await Promise.allSettled(
        globals.tasks.map((task) => task.trigger?.disable()),
      );
      setGlobals({
        tasks: [],
        connections: [],
      } as never);
    }
  });
});
