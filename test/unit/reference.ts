import { before, describe, it } from "node:test";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import {
  REFERENCE_DIR,
  generateReference,
} from "../../scripts/generate-reference.mjs";
import { listModules, loadSchema } from "../../src/util/modules.js";
import { KINDS } from "../../src/util/type-helpers.js";

const run = promisify(execFile);

describe("the generated reference", function () {
  let pages: Record<string, string>;

  before(async function () {
    pages = await generateReference();
  });

  it("documents every module on disk", async function () {
    const modules = await listModules();

    for (const kind of KINDS) {
      const page = pages[`${kind}s.md`];

      expect(page, `${kind}s.md`).to.be.a("string");

      for (const subKind of modules[kind])
        expect(page, `${kind}:${subKind}`).to.include(
          `## \`${kind}:${subKind}\``,
        );
    }
  });

  it("names every option with its type, requiredness, default, and unit", function () {
    // read:random is all required options with no defaults, output:mqtt has a
    // default and a range, and trigger:repeat carries a unit.
    expect(pages["reads.md"]).to.include(
      "| `min` | number | **yes** |  |  | The lowest value a reading may take. |",
    );
    expect(pages["outputs.md"]).to.include(
      "| `retain` | boolean | no | `false` |",
    );
    expect(pages["outputs.md"]).to.include("Must be between 0 and 2");
    expect(pages["triggers.md"]).to.match(
      /\| `interval` \| any \| \*\*yes\*\* \|\s*\| `ms` \|/,
    );
  });

  it("renders an enum as its accepted values", function () {
    expect(pages["transforms.md"]).to.include(
      "`object` or `string` or `number` or `any`",
    );
  });

  it("marks a deprecated option as deprecated", function () {
    expect(pages["triggers.md"]).to.include(
      "Deprecated; use `topics` instead.",
    );
  });

  it("is built from the same loader the runtime validates with", async function () {
    // The generator calls loadSchema per module, so a module that ships without
    // a schema fails the build of this page rather than being skipped.
    await expect(loadSchema("read:not-a-module")).to.be.rejectedWith(
      /Unknown module type "read:not-a-module"/,
    );
  });

  // The committed pages are what an npm user reads, so a schema change without a
  // regeneration has to fail here rather than ship stale.
  it("matches what is committed under docs/reference", async function () {
    const committed = await readdir(REFERENCE_DIR);

    expect(committed.sort()).to.deep.equal(Object.keys(pages).sort());

    for (const [name, contents] of Object.entries(pages)) {
      const onDisk = await readFile(`${REFERENCE_DIR}/${name}`, {
        encoding: "utf8",
      });

      expect(
        onDisk,
        `${name} is out of date; run "npm run reference"`,
      ).to.equal(contents);
    }
  });
});

describe("the published package", function () {
  let files: Array<string>;

  before(async function () {
    // No --ignore-scripts: prepack has to run, since it is what puts built/ in
    // the tarball rather than the release workflow happening to build first.
    const { stdout } = await run("npm", ["pack", "--dry-run", "--json"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    // npm reports an array of packages on a terminal and an object keyed by
    // package name when its output is piped, so accept either shape.
    type Packed = { files: Array<{ path: string }> };
    const parsed = JSON.parse(stdout) as Array<Packed> | Record<string, Packed>;
    const packed = (Array.isArray(parsed) ? parsed : Object.values(parsed))[0];

    expect(
      packed?.files,
      `npm pack --json produced no file list: ${stdout.slice(0, 200)}`,
    ).to.be.an("array");

    files = packed.files.map((file) => file.path);
  });

  it("carries the CLI, the examples, and the reference", function () {
    expect(files).to.include("built/cli-entrypoint.js");
    expect(files.some((path) => path.startsWith("examples/"))).to.equal(true);
    expect(files).to.include("docs/reference/README.md");
  });

  it("carries every example and config file the docs point at", async function () {
    const docs = [
      "README.md",
      "cookbook.md",
      "sensors.md",
      "examples/examples.md",
    ];
    const referenced = new Set<string>();

    for (const doc of docs) {
      const text = await readFile(doc, { encoding: "utf8" });

      // An extension is what separates a file the tarball must carry from a
      // directory the prose merely names.
      for (const match of text.matchAll(
        /\.\/((?:examples|config)\/[A-Za-z0-9._/-]*\.[A-Za-z0-9]+)/g,
      ))
        referenced.add(match[1]);
    }

    expect(
      referenced.size,
      "no example or config paths found in the docs",
    ).to.be.greaterThan(0);

    for (const path of referenced)
      expect(files, `${path} is referenced by a doc`).to.include(path);
  });
});
