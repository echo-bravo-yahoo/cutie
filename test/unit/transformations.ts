import { describe, it, before } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { setGlobals } from "../../src/index.js";

import { OffsetConfig } from "../../src/transforms/offset.js";
import { RoundConfig } from "../../src/transforms/round.js";
import { ShellConfig } from "../../src/transforms/shell.js";
import { ConvertConfig } from "../../src/transforms/convert.js";
import { MergeConfig } from "../../src/transforms/merge.js";
import { MungeConfig } from "../../src/transforms/munge.js";
import { JavascriptConfig } from "../../src/transforms/javascript.js";
import { PrettifyConfig } from "../../src/transforms/prettify.js";
import { UglifyConfig } from "../../src/transforms/uglify.js";
// import { AggregateConfig } from "../transforms/aggregate.js";

describe("transforms", function () {
  const fakeLogger = {
    emit: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  before(() => {
    setGlobals({ logger: fakeLogger });
  });

  describe("specific transformers", function () {
    describe("merge", function () {
      it("can merge a literal object", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:merge",
                sources: [{ node: "livingRoom" }],
              } as MergeConfig,
            ],
          },
          "can merge a literal object",
        );
        await task.register();

        const transformed = await task.startMessage({ temp: 7 });
        expect(transformed).to.deep.equal({ temp: 7, node: "livingRoom" });
      });

      it("can merge an object derived by interpolation", async function () {
        const task = new Task(
          {
            data: {
              node: "bedRoom",
            },
            steps: [
              {
                type: "transform:merge",
                sources: ["$$task.config.data"],
              } as MergeConfig,
            ],
          },
          "can merge a literal object",
        );
        await task.register();

        const transformed = await task.startMessage({ temp: 7 });
        expect(transformed).to.deep.equal({ temp: 7, node: "bedRoom" });
      });

      it("can merge a variety of things at once", async function () {
        const task = new Task(
          {
            data: {
              // both sources have a metadata field that gets merged together
              metadata: {
                node: "bedRoom",
              },
            },
            steps: [
              {
                type: "transform:merge",
                sources: [
                  "$$task.config.data",
                  { metadata: { priority: "high" } },
                ],
              } as MergeConfig,
            ],
          },
          "can merge a variety of things at once",
        );
        await task.register();

        const transformed = await task.startMessage({ temp: 7 });
        expect(transformed).to.deep.equal({
          temp: 7,
          metadata: {
            node: "bedRoom",
            priority: "high",
          },
        });
      });

      it("merges objects and arrays by last-write-wins", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:merge",
                sources: [
                  { priority: "low" },
                  { priority: "high" },
                  { data: [1, 2, 3] },
                  { data: [4, 5, 6] },
                  { data: [7] },
                ],
              } as MergeConfig,
            ],
          },
          "merges objects and arrays by last-write-wins",
        );
        await task.register();

        const transformed = await task.startMessage({ temp: 7 });
        expect(transformed).to.deep.equal({
          temp: 7,
          priority: "high",
          data: [7],
        });
      });
    });

    describe("offset", function () {
      // TO-DO: find out why the first test in this file (regardless of which) takes ~50 ms)
      it("works on primitive readings", async function () {
        const task = new Task(
          {
            steps: [{ type: "transform:offset", offset: -5 } as OffsetConfig],
          },
          "works on primitive readings",
        );
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.startMessage(5);
        expect(transformed).to.deep.equal(0);
      });

      it("works on simple readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                path: "temp",
                offset: -5,
              } as OffsetConfig,
            ],
          },
          "works on simple readings",
        );
        await task.register();

        // a simple reading is one with only one key/value pair in it
        const transformed = await task.startMessage({ temp: 5 });
        expect(transformed).to.deep.equal({ temp: 0 });
      });

      it("works on composite readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                paths: { temp: { offset: -5 }, humidity: { offset: 10 } },
              } as OffsetConfig,
            ],
          },
          "works on composite readings",
        );
        await task.register();

        // a composite reading is one with multiple key/value pairs in it
        const transformed = await task.startMessage({
          temp: 5,
          humidity: 30,
        });
        expect(transformed).to.deep.equal({ temp: 0, humidity: 40 });
      });

      it("works on arrays of primitive readings", async function () {
        const task = new Task(
          {
            steps: [{ type: "transform:offset", offset: -5 } as OffsetConfig],
          },
          "works on arrays of primitive readings",
        );
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.startMessage([1, 2, 3, 4, 5]);
        expect(transformed).to.deep.equal([-4, -3, -2, -1, 0]);
      });

      it("works on arrays of primitive readings with a base path", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                offset: -5,
                basePath: "weather",
              } as OffsetConfig,
            ],
          },
          "works on arrays of primitive readings with a base path",
        );
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.startMessage({
          weather: [1, 2, 3, 4, 5],
        });
        expect(transformed).to.deep.equal({ weather: [-4, -3, -2, -1, 0] });
      });

      it("works on arrays of simple readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                path: "temp",
                offset: -5,
              } as OffsetConfig,
            ],
          },
          "works on arrays of simple readings",
        );
        await task.register();

        // a simple reading is one with only one key/value pair in it
        const transformed = await task.startMessage([
          { temp: 1 },
          { temp: 2 },
          { temp: 3 },
          { temp: 4 },
          { temp: 5 },
        ]);
        expect(transformed).to.deep.equal([
          { temp: -4 },
          { temp: -3 },
          { temp: -2 },
          { temp: -1 },
          { temp: 0 },
        ]);
      });

      it("works on arrays of simple readings with a base path", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                basePath: "weather",
                path: "temp",
                offset: -5,
              } as OffsetConfig,
            ],
          },
          "works on arrays of simple readings with a base path",
        );
        await task.register();

        // a simple reading is one with only one key/value pair in it
        const transformed = await task.startMessage({
          weather: [
            { temp: 1 },
            { temp: 2 },
            { temp: 3 },
            { temp: 4 },
            { temp: 5 },
          ],
        });
        expect(transformed).to.deep.equal({
          weather: [
            { temp: -4 },
            { temp: -3 },
            { temp: -2 },
            { temp: -1 },
            { temp: 0 },
          ],
        });
      });

      it("works on arrays of composite readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                paths: { temp: { offset: -5 }, humidity: { offset: -10 } },
              } as OffsetConfig,
            ],
          },
          "works on arrays of composite readings",
        );
        await task.register();

        // a composite reading is one with only one key/value pair in it
        const transformed = await task.startMessage([
          { temp: 1, humidity: 30 },
          { temp: 2, humidity: 31 },
          { temp: 3, humidity: 32 },
          { temp: 4, humidity: 33 },
          { temp: 5, humidity: 34 },
        ]);
        expect(transformed).to.deep.equal([
          { temp: -4, humidity: 20 },
          { temp: -3, humidity: 21 },
          { temp: -2, humidity: 22 },
          { temp: -1, humidity: 23 },
          { temp: 0, humidity: 24 },
        ]);
      });

      it("works on arrays of composite readings with a base path", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:offset",
                basePath: "weather",
                paths: { temp: { offset: -5 }, humidity: { offset: 1 } },
              } as OffsetConfig,
            ],
          },
          "works on arrays of composite readings with a base path",
        );
        await task.register();

        // a composite reading is one with only one key/value pair in it
        const transformed = await task.startMessage({
          weather: [
            { temp: 1, humidity: 30 },
            { temp: 2, humidity: 31 },
            { temp: 3, humidity: 32 },
            { temp: 4, humidity: 33 },
            { temp: 5, humidity: 34 },
          ],
        });
        expect(transformed).to.deep.equal({
          weather: [
            { temp: -4, humidity: 31 },
            { temp: -3, humidity: 32 },
            { temp: -2, humidity: 33 },
            { temp: -1, humidity: 34 },
            { temp: 0, humidity: 35 },
          ],
        });
      });
    });

    describe("round", function () {
      it("works for all directions", async function () {
        const testCases = [
          { direction: "round", input: 21.0, output: 21.0 },
          { direction: "round", input: 21.001, output: 21.0 },
          // TODO: use better rounding algorithm that doesn't fail on this test case...
          // { direction: "round", input: 21.005, output: 21.01 },
          { direction: "round", input: 21.009, output: 21.01 },
          { direction: "up", input: 21.0, output: 21.0 },
          { direction: "up", input: 21.001, output: 21.01 },
          { direction: "up", input: 21.005, output: 21.01 },
          { direction: "up", input: 21.009, output: 21.01 },
          { direction: "down", input: 21.0, output: 21.0 },
          { direction: "down", input: 21.001, output: 21.0 },
          { direction: "down", input: 21.005, output: 21.0 },
          { direction: "down", input: 21.009, output: 21.0 },
        ];

        for (const testCase of testCases) {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:round",
                  precision: 2,
                  direction: testCase.direction,
                } as RoundConfig,
              ],
            },
            "works for all directions",
          );
          await task.register();

          const transformed = await task.startMessage(testCase.input);
          expect(transformed).to.equal(testCase.output);
        }
      });

      it("works for precision of 0 (integer)", async function () {
        const testCases = [
          { direction: "round", input: 21.0, output: 21 },
          { direction: "round", input: 21.1, output: 21 },
          { direction: "round", input: 21.5, output: 22 },
          { direction: "round", input: 21.9, output: 22 },
          { direction: "up", input: 21.0, output: 21 },
          { direction: "up", input: 21.1, output: 22 },
          { direction: "up", input: 21.5, output: 22 },
          { direction: "up", input: 21.9, output: 22 },
          { direction: "down", input: 21.0, output: 21 },
          { direction: "down", input: 21.1, output: 21 },
          { direction: "down", input: 21.5, output: 21 },
          { direction: "down", input: 21.9, output: 21 },
        ];

        for (const testCase of testCases) {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:round",
                  precision: 0,
                  direction: testCase.direction,
                } as RoundConfig,
              ],
            },
            "works for precision of 0 (integer)",
          );
          await task.register();

          const transformed = await task.startMessage(testCase.input);
          expect(transformed).to.equal(testCase.output);
        }
      });
      it.skip("works on primitive readings", async function () {});
      it.skip("works on simple readings", async function () {});
      it.skip("works on composite readings", async function () {});
    });

    describe("aggregate", function () {
      it("works on arrays of primitive readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:aggregate",
                aggregation: "average",
              } as any,
            ],
          },
          "works on arrays of primitive readings",
        );
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.startMessage([2, 3, 4, 5]);
        expect(transformed).to.deep.equal(3.5);
      });

      it("works on arrays of simple readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:aggregate",
                aggregation: "average",
                path: "temp",
              } as any,
            ],
          },
          "works on arrays of simple readings",
        );
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.startMessage([
          { temp: 2 },
          { temp: 3 },
          { temp: 4 },
          { temp: 5 },
        ]);
        expect(transformed).to.deep.equal({ temp: 3.5 });
      });

      it("works on arrays of composite readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:aggregate",
                paths: {
                  temp: { aggregation: "average" },
                  humidity: { aggregation: "latest" },
                },
              } as any,
            ],
          },
          "works on arrays of composite readings",
        );
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.startMessage([
          { temp: 2, humidity: 20 },
          { temp: 3, humidity: 20 },
          { temp: 4, humidity: 20 },
          { temp: 5, humidity: 19 },
        ]);
        expect(transformed).to.deep.equal({ temp: 3.5, humidity: 19 });
      });
    });

    describe("munge", function () {
      it("works for all operations", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:munge",
                paths: {
                  "weather.temp": {
                    op: "rename",
                    to: "heat",
                  },
                  "weather.humidity": {
                    op: "retain",
                  },
                  "weather.windSpeed": {
                    op: "remove",
                  },
                  "weather.windDirection": {
                    op: "duplicate",
                    to: "dir",
                  },
                },
              } as MungeConfig,
            ],
          },
          "works for all operations",
        );
        await task.register();

        const transformed = await task.startMessage({
          weather: { temp: 5, humidity: 23, windSpeed: 4, windDirection: "SE" },
        });
        expect(transformed).to.deep.equal({
          heat: 5,
          weather: { humidity: 23, windDirection: "SE" },
          dir: "SE",
        });
      });

      it("works for unwrapping an object to a primitive", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:munge",
                paths: {
                  temp: {
                    op: "rename",
                    to: ".",
                  },
                },
              } as MungeConfig,
            ],
          },
          "works for unwrapping an object to a primitive",
        );
        await task.register();

        const transformed = await task.startMessage({
          temp: 5,
        });
        expect(transformed).to.deep.equal(5);
      });

      it("works for wrapping a primitive into an object", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:munge",
                paths: {
                  ".": {
                    op: "rename",
                    to: "temp",
                  },
                },
              } as MungeConfig,
            ],
          },
          "works for wrapping a primitive into an object",
        );
        await task.register();

        const transformed = await task.startMessage(5);
        expect(transformed).to.deep.equal({ temp: 5 });
      });

      it("works for removing all unspecified keys", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:munge",
                paths: {
                  saturday: {
                    op: "retain",
                  },
                  sunday: {
                    op: "retain",
                  },
                  "*": {
                    op: "remove",
                  },
                },
              } as MungeConfig,
            ],
          },
          "works for removing all unspecified keys",
        );
        await task.register();

        const transformed = await task.startMessage({
          monday: 15,
          tuesday: 12,
          wednesday: 14,
          thursday: 14,
          friday: 8,
          saturday: 2,
          sunday: 8,
        });
        expect(transformed).to.deep.equal({ saturday: 2, sunday: 8 });
      });

      it("works for retaining all unspecified keys", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:munge",
                paths: {
                  monday: {
                    op: "remove",
                  },
                  "*": {
                    op: "retain",
                  },
                },
              } as MungeConfig,
            ],
          },
          "works for retaining all unspecified keys",
        );
        await task.register();

        const transformed = await task.startMessage({
          monday: 15,
          tuesday: 12,
          wednesday: 14,
          thursday: 14,
          friday: 8,
          saturday: 2,
          sunday: 8,
        });
        expect(transformed).to.deep.equal({
          tuesday: 12,
          wednesday: 14,
          thursday: 14,
          friday: 8,
          saturday: 2,
          sunday: 8,
        });
      });
    });

    describe("convert", function () {
      describe("celsius to fahrenheit", function () {
        it("works on primitive readings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  from: "celsius",
                  to: "fahrenheit",
                } as ConvertConfig,
              ],
            },
            "works on primitive readings",
          );
          await task.register();

          const transformed = await task.startMessage(21.1);
          expect(transformed).to.deep.equal(69.98);
        });
        it.skip("works on simple readings", async function () {});
        it.skip("works on composite readings", async function () {});
      });

      describe("fahrenheit to celsius", () => {
        it("works on primitive readings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  from: "fahrenheit",
                  to: "celsius",
                } as ConvertConfig,
              ],
            },
            "works on primitive readings",
          );
          await task.register();

          const transformed = await task.startMessage(69.98);
          expect(transformed).to.deep.equal(21.1);
        });
        it.skip("works on simple readings", async function () {});
        it.skip("works on composite readings", async function () {});
      });
      describe("fails", function () {
        it("when provided an incorrect 'to' or 'from'", async function () {
          let task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  from: "nonsense",
                  to: "celsius",
                } as unknown as ConvertConfig,
              ],
            },
            "works on primitive readings",
          );
          await task.register();

          expect(task.startMessage(20)).to.eventually.be.rejectedWith(
            Error,
            /Unknown conversion from "nonsense" to "celsius" in config./,
          );

          task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  from: "fahrenheit",
                  to: "nonsense",
                } as unknown as ConvertConfig,
              ],
            },
            "works on primitive readings",
          );
          await task.register();

          expect(task.startMessage(20)).to.eventually.be.rejectedWith(
            Error,
            /Unknown conversion from "fahrenheit" to "nonsense" in config./,
          );

          task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  from: "nonsense",
                  to: "double-nonsense",
                } as unknown as ConvertConfig,
              ],
            },
            "works on primitive readings",
          );
          await task.register();

          expect(task.startMessage(20)).to.eventually.be.rejectedWith(
            Error,
            /Unknown conversion from "nonsense" to "double-nonsense" in config./,
          );
        });
      });
    });

    describe("shell", function () {
      describe("files", function () {
        it("works for objects", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:shell",
                  codePath: "./test/unit/fixtures/echo.sh",
                  outputType: "object",
                } as ShellConfig,
              ],
            },
            "works for objects",
          );
          await task.register();

          const transformed = await task.startMessage({
            test: { object: "is deep" },
          });
          expect(transformed).to.deep.equal({ test: { object: "is deep" } });
        });

        it("works for strings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:shell",
                  codePath: "./test/unit/fixtures/echo.sh",
                  outputType: "string",
                } as ShellConfig,
              ],
            },
            "works for strings",
          );
          await task.register();

          const transformed = await task.startMessage("cutie");
          expect(transformed).to.deep.equal("cutie");
        });

        it("works for numbers", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:shell",
                  codePath: "./test/unit/fixtures/echo.sh",
                  outputType: "number",
                } as ShellConfig,
              ],
            },
            "works for numbers",
          );
          await task.register();

          const transformed = await task.startMessage(5);
          expect(transformed).to.deep.equal(5);
        });
      });

      describe("commands", function () {
        it("works for objects", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:shell",
                  command: "echo '${message}'",
                  outputType: "object",
                } as ShellConfig,
              ],
            },
            "works for objects",
          );
          await task.register();

          const transformed = await task.startMessage({
            test: { object: "is deep" },
          });
          expect(transformed).to.deep.equal({ test: { object: "is deep" } });
        });

        it("works for strings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:shell",
                  command: "echo 'hello, ${message}'",
                  outputType: "string",
                } as ShellConfig,
              ],
            },
            "works for strings",
          );
          await task.register();

          const transformed = await task.startMessage("cutie");
          expect(transformed).to.deep.equal("hello, cutie");
        });

        it("works for numbers", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:shell",
                  command: "echo $((1+${message}))",
                  outputType: "number",
                } as ShellConfig,
              ],
            },
            "works for numbers",
          );
          await task.register();

          const transformed = await task.startMessage(5);
          expect(transformed).to.deep.equal(6);
        });
      });
    });

    describe("javascript", function () {
      describe("commands", function () {
        it("works for number literals", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:javascript",
                  command: "10 + message",
                } as JavascriptConfig,
              ],
            },
            "works for number literals",
          );
          await task.register();

          const transformed = await task.startMessage(8);
          expect(transformed).to.deep.equal(18);
        });
      });

      describe("files", function () {
        it("works for number literals", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:javascript",
                  codePath: "./test/unit/fixtures/addOne.js",
                } as JavascriptConfig,
              ],
            },
            "works for number literals",
          );
          await task.register();

          const transformed = await task.startMessage(8);
          expect(transformed).to.deep.equal(9);
        });
      });
    });

    describe("prettify", function () {
      it("works for objects", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:prettify",
              } as PrettifyConfig,
            ],
          },
          "works for objects",
        );
        await task.register();

        const transformed = await task.startMessage({
          a: 1,
          b: "hi",
          c: null,
        });
        expect(transformed).to.equal(
          `{\n    "a": 1,\n    "b": "hi",\n    "c": null\n}`,
        );
      });

      it("works for strings when parseInput is set", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:prettify",
                parseInput: true,
              } as PrettifyConfig,
            ],
          },
          "works for strings when parseInput is set",
        );
        await task.register();

        const transformed = await task.startMessage(
          '{"a":1, "b": "hi", "c": null}',
        );
        expect(transformed).to.equal(
          `{\n    "a": 1,\n    "b": "hi",\n    "c": null\n}`,
        );
      });

      it("passes through unknown values", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:prettify",
              } as PrettifyConfig,
            ],
          },
          "passes through unknown values",
        );
        await task.register();

        let transformed = await task.startMessage(undefined);
        expect(transformed).to.equal(undefined);
        transformed = await task.startMessage(12.3);
        expect(transformed).to.equal(12.3);
      });

      it("passes through strings if parseInput is not set", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:prettify",
              } as PrettifyConfig,
            ],
          },
          "passes through strings if parseInput is not set",
        );
        await task.register();

        const transformed = await task.startMessage(
          '{"parseable": "but not modified"}',
        );
        expect(transformed).to.equal('{"parseable": "but not modified"}');
      });

      it("allows for customizing the amount of whitespace", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:prettify",
                spaces: 2,
              } as PrettifyConfig,
            ],
          },
          "allows for customizing the amount of whitespace",
        );
        await task.register();

        const transformed = await task.startMessage({
          a: 1,
          b: "hi",
          c: null,
        });
        expect(transformed).to.equal(
          `{\n  "a": 1,\n  "b": "hi",\n  "c": null\n}`,
        );
      });
    });

    describe("uglify", function () {
      it("works for objects", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:uglify",
              } as UglifyConfig,
            ],
          },
          "works for objects",
        );
        await task.register();

        const transformed = await task.startMessage({
          a: 1,
          b: "hi",
          c: null,
        });
        expect(transformed).to.equal(`{"a":1,"b":"hi","c":null}`);
      });

      it("works for strings when parseInput is set", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:uglify",
                parseInput: true,
              } as UglifyConfig,
            ],
          },
          "works for strings when parseInput is set",
        );
        await task.register();

        const transformed = await task.startMessage(
          '{"a":1, "b": "hi", "c": null}',
        );
        expect(transformed).to.equal(`{"a":1,"b":"hi","c":null}`);
      });

      it("passes through unknown values", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:uglify",
              } as UglifyConfig,
            ],
          },
          "passes through unknown values",
        );
        await task.register();

        let transformed = await task.startMessage(undefined);
        expect(transformed).to.equal(undefined);
        transformed = await task.startMessage(12.3);
        expect(transformed).to.equal(12.3);
      });

      it("passes through strings if parseInput is not set", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:uglify",
              } as UglifyConfig,
            ],
          },
          "passes through strings if parseInput is not set",
        );
        await task.register();

        const transformed = await task.startMessage(
          '{"parseable": "but not modified"}',
        );
        expect(transformed).to.equal('{"parseable": "but not modified"}');
      });
    });
  });
});
