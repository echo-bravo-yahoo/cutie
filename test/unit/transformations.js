import { expect } from "chai";

import Task from "../../src/util/generic-task.js";
import { setGlobals } from "../../src/index.js";

describe("transformations", function () {
  before(() => {
    setGlobals({ logger: { info: () => {}, debug: () => {} } });
  });

  describe("specific transformers", function () {
    describe("offset", function () {
      it("works on primitive readings", async function () {
        const task = new Task({
          steps: [{ type: "transformation:offset", offset: -5 }],
        });
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.handleMessage(5);
        expect(transformed).to.deep.equal(0);
      });

      it("works on simple readings", async function () {
        const task = new Task({
          steps: [{ type: "transformation:offset", path: "temp", offset: -5 }],
        });
        await task.register();

        // a simple reading is one with only one key/value pair in it
        const transformed = await task.handleMessage({ temp: 5 });
        expect(transformed).to.deep.equal({ temp: 0 });
      });

      it("works on composite readings", async function () {
        const task = new Task({
          steps: [
            {
              type: "transformation:offset",
              paths: { temp: { offset: -5 }, humidity: { offset: 10 } },
            },
          ],
        });
        await task.register();

        // a composite reading is one with multiple key/value pairs in it
        const transformed = await task.handleMessage({
          temp: 5,
          humidity: 30,
        });
        expect(transformed).to.deep.equal({ temp: 0, humidity: 40 });
      });

      it("works on arrays of primitive readings", async function () {
        const task = new Task({
          steps: [{ type: "transformation:offset", offset: -5 }],
        });
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.handleMessage([1, 2, 3, 4, 5]);
        expect(transformed).to.deep.equal([-4, -3, -2, -1, 0]);
      });

      it("works on arrays of primitive readings with a base path", async function () {
        const task = new Task({
          steps: [
            { type: "transformation:offset", offset: -5, basePath: "weather" },
          ],
        });
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.handleMessage({
          weather: [1, 2, 3, 4, 5],
        });
        expect(transformed).to.deep.equal({ weather: [-4, -3, -2, -1, 0] });
      });

      it("works on arrays of simple readings", async function () {
        const task = new Task({
          steps: [{ type: "transformation:offset", path: "temp", offset: -5 }],
        });
        await task.register();

        // a simple reading is one with only one key/value pair in it
        const transformed = await task.handleMessage([
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
        const task = new Task({
          steps: [
            {
              type: "transformation:offset",
              basePath: "weather",
              path: "temp",
              offset: -5,
            },
          ],
        });
        await task.register();

        // a simple reading is one with only one key/value pair in it
        const transformed = await task.handleMessage({
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
        const task = new Task({
          steps: [
            {
              type: "transformation:offset",
              paths: { temp: { offset: -5 }, humidity: { offset: -10 } },
            },
          ],
        });
        await task.register();

        // a composite reading is one with only one key/value pair in it
        const transformed = await task.handleMessage([
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
        const task = new Task({
          steps: [
            {
              type: "transformation:offset",
              basePath: "weather",
              paths: { temp: { offset: -5 }, humidity: { offset: 1 } },
            },
          ],
        });
        await task.register();

        // a composite reading is one with only one key/value pair in it
        const transformed = await task.handleMessage({
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

        for (let testCase of testCases) {
          const task = new Task({
            steps: [
              {
                type: "transformation:round",
                precision: 2,
                direction: testCase.direction,
              },
            ],
          });
          await task.register();

          const transformed = await task.handleMessage(testCase.input);
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

        for (let testCase of testCases) {
          const task = new Task({
            steps: [
              {
                type: "transformation:round",
                precision: 0,
                direction: testCase.direction,
              },
            ],
          });
          await task.register();

          const transformed = await task.handleMessage(testCase.input);
          expect(transformed).to.equal(testCase.output);
        }
      });
      it.skip("works on primitive readings", async function () {});
      it.skip("works on simple readings", async function () {});
      it.skip("works on composite readings", async function () {});
    });
    describe("aggregate", function () {
      it("works on arrays of primitive readings", async function () {
        const task = new Task({
          steps: [{ type: "transformation:aggregate", aggregation: "average" }],
        });
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.handleMessage([2, 3, 4, 5]);
        expect(transformed).to.deep.equal(3.5);
      });

      it("works on arrays of simple readings", async function () {
        const task = new Task({
          steps: [
            {
              type: "transformation:aggregate",
              aggregation: "average",
              path: "temp",
            },
          ],
        });
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.handleMessage([
          { temp: 2 },
          { temp: 3 },
          { temp: 4 },
          { temp: 5 },
        ]);
        expect(transformed).to.deep.equal({ temp: 3.5 });
      });

      it("works on arrays of composite readings", async function () {
        const task = new Task({
          steps: [
            {
              type: "transformation:aggregate",
              paths: {
                temp: { aggregation: "average" },
                humidity: { aggregation: "latest" },
              },
            },
          ],
        });
        await task.register();

        // a primitive reading is one not wrapped in an object
        const transformed = await task.handleMessage([
          { temp: 2, humidity: 20 },
          { temp: 3, humidity: 20 },
          { temp: 4, humidity: 20 },
          { temp: 5, humidity: 19 },
        ]);
        expect(transformed).to.deep.equal({ temp: 3.5, humidity: 19 });
      });
    });

    describe("convert", function () {
      describe("celsius to fahrenheit", function () {
        it("works on primitive readings", async function () {
          const task = new Task({
            steps: [
              {
                type: "transformation:convert",
                from: "celsius",
                to: "fahrenheit",
              },
            ],
          });
          await task.register();

          const transformed = await task.handleMessage(21.1);
          expect(transformed).to.deep.equal(69.98);
        });
        it.skip("works on simple readings", async function () {});
        it.skip("works on composite readings", async function () {});
      });

      describe("fahrenheit to celsius ", () => {
        it("works on primitive readings", async function () {
          const task = new Task({
            steps: [
              {
                type: "transformation:convert",
                from: "fahrenheit",
                to: "celsius",
              },
            ],
          });
          await task.register();

          const transformed = await task.handleMessage(69.98);
          expect(transformed).to.deep.equal(21.1);
        });
        it.skip("works on simple readings", async function () {});
        it.skip("works on composite readings", async function () {});
      });
    });
  });
});
