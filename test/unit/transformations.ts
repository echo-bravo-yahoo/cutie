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
    // codePath resolves against the config file's directory; the fixtures below
    // are addressed relative to the repo root, so that is the config directory
    // for these tests.
    setGlobals({ logger: fakeLogger, configDir: process.cwd() } as any);
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
                sources: ["${task.config.data}"],
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
                  "${task.config.data}",
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

      it('replaces arrays when arrayStrategy is "replace"', async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:merge",
                arrayStrategy: "replace",
                sources: [{ data: [4, 5] }],
              } as MergeConfig,
            ],
          },
          "replaces arrays",
        );
        await task.register();

        const transformed = await task.startMessage({ data: [1, 2, 3] });
        expect(transformed).to.deep.equal({ data: [4, 5] });
      });

      it('concatenates arrays when arrayStrategy is "concat"', async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:merge",
                arrayStrategy: "concat",
                sources: [{ data: [4, 5] }],
              } as MergeConfig,
            ],
          },
          "concatenates arrays",
        );
        await task.register();

        const transformed = await task.startMessage({ data: [1, 2, 3] });
        expect(transformed).to.deep.equal({ data: [1, 2, 3, 4, 5] });
      });

      it("replaces arrays when arrayStrategy is omitted", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:merge",
                sources: [{ data: [4, 5] }],
              } as MergeConfig,
            ],
          },
          "replaces arrays by default",
        );
        await task.register();

        const transformed = await task.startMessage({ data: [1, 2, 3] });
        expect(transformed).to.deep.equal({ data: [4, 5] });
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
          { direction: "round", input: 21.005, output: 21.01 },
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
      it("works for negative values in all directions", async function () {
        // the old split-integer algorithm floored the integer part, which made
        // "up" and "down" inconsistent below zero
        const testCases = [
          { direction: "round", input: -21.005, output: -21.0 },
          { direction: "round", input: -21.009, output: -21.01 },
          { direction: "up", input: -21.001, output: -21.0 },
          { direction: "up", input: -21.009, output: -21.0 },
          { direction: "down", input: -21.001, output: -21.01 },
          { direction: "down", input: -21.009, output: -21.01 },
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
            "works for negative values in all directions",
          );
          await task.register();

          const transformed = await task.startMessage(testCase.input);
          expect(
            transformed,
            `${testCase.direction} of ${testCase.input}`,
          ).to.equal(testCase.output);
        }
      });

      it("works on primitive readings", async function () {
        const task = new Task(
          {
            steps: [{ type: "transform:round", precision: 2 } as RoundConfig],
          },
          "works on primitive readings",
        );
        await task.register();

        const transformed = await task.startMessage(21.005);
        expect(transformed).to.equal(21.01);
      });

      it("works on simple readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:round",
                path: "temp",
                precision: 2,
              } as RoundConfig,
            ],
          },
          "works on simple readings",
        );
        await task.register();

        const transformed = await task.startMessage({ temp: 21.005 });
        expect(transformed).to.deep.equal({ temp: 21.01 });
      });

      it("works on composite readings", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:round",
                paths: {
                  temp: { precision: 2 },
                  humidity: { precision: 1, direction: "down" },
                },
              } as unknown as RoundConfig,
            ],
          },
          "works on composite readings",
        );
        await task.register();

        const transformed = await task.startMessage({
          temp: 21.005,
          humidity: 48.99,
        });
        expect(transformed).to.deep.equal({ temp: 21.01, humidity: 48.9 });
      });
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

        it("works on simple readings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  path: "temp",
                  from: "celsius",
                  to: "fahrenheit",
                } as ConvertConfig,
              ],
            },
            "works on simple readings",
          );
          await task.register();

          const transformed = await task.startMessage({ temp: 21.1 });
          expect(transformed).to.deep.equal({ temp: 69.98 });
        });

        it("works on composite readings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  paths: {
                    inside: { from: "celsius", to: "fahrenheit" },
                    outside: { from: "celsius", to: "fahrenheit" },
                  },
                } as ConvertConfig,
              ],
            },
            "works on composite readings",
          );
          await task.register();

          const transformed = await task.startMessage({
            inside: 21.1,
            outside: 0,
          });
          expect(transformed).to.deep.equal({ inside: 69.98, outside: 32 });
        });
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

        it("works on simple readings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  path: "temp",
                  from: "fahrenheit",
                  to: "celsius",
                } as ConvertConfig,
              ],
            },
            "works on simple readings",
          );
          await task.register();

          const transformed = await task.startMessage({ temp: 69.98 });
          expect(transformed).to.deep.equal({ temp: 21.1 });
        });

        it("works on composite readings", async function () {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  paths: {
                    inside: { from: "fahrenheit", to: "celsius" },
                    outside: { from: "fahrenheit", to: "celsius" },
                  },
                } as ConvertConfig,
              ],
            },
            "works on composite readings",
          );
          await task.register();

          const transformed = await task.startMessage({
            inside: 69.98,
            outside: 32,
          });
          expect(transformed).to.deep.equal({ inside: 21.1, outside: 0 });
        });
      });
      describe("fails", function () {
        // An unknown unit is now caught when the task registers rather than on
        // the first message, so a wrong config never runs at all.
        function converting(from: string, to: string) {
          const task = new Task(
            {
              steps: [
                {
                  type: "transform:convert",
                  from,
                  to,
                } as unknown as ConvertConfig,
              ],
            },
            `converts ${from} to ${to}`,
          );

          return task.register();
        }

        it("at registration when 'from' is not a unit", async function () {
          await expect(converting("nonsense", "celsius")).to.be.rejectedWith(
            /"from" is "nonsense", which is not one of: celsius, fahrenheit, kelvin/,
          );
        });

        it("at registration when 'to' is not a unit", async function () {
          await expect(converting("fahrenheit", "nonsense")).to.be.rejectedWith(
            /"to" is "nonsense", which is not one of: celsius, fahrenheit, kelvin/,
          );
        });

        it("at registration when neither is a unit", async function () {
          await expect(
            converting("nonsense", "double-nonsense"),
          ).to.be.rejectedWith(/"from" is "nonsense"/);
        });

        it("at registration when the units are different dimensions", async function () {
          await expect(converting("celsius", "pascal")).to.be.rejectedWith(
            /cannot convert celsius \(temperature\) to pascal \(pressure\)/,
          );
        });

        it("at registration when the units are the same", async function () {
          await expect(converting("celsius", "celsius")).to.be.rejectedWith(
            /both "celsius".*would do nothing/,
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

      // A disabled step is left out of the task's chain entirely rather than
      // reached and made to return unchanged, so there is no per-step guard
      // left to test here; test/unit/chain.ts covers the chain-level
      // behaviour. This step gets its own regression test anyway because it
      // once ran an arbitrary command even while disabled.
      it("is left out of the chain when it is disabled", async function () {
        const task = new Task(
          {
            steps: [
              {
                type: "transform:shell",
                disabled: true,
                command: "echo 'ran'",
                outputType: "string",
              } as ShellConfig,
              { type: "output:console" } as any,
            ],
          },
          "a disabled shell",
        );
        await task.register();

        expect(task.steps.map((step) => step.config.type)).to.deep.equal([
          "output:console",
        ]);
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
                  command: "return 10 + message",
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
