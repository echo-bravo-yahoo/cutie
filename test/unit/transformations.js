import { expect } from "chai";

import { Module } from "../../src/util/generic-module.js";

describe("transformations", function () {
  it("works on primitive readings", async function () {
    const module = new Module({
      transformations: [{ type: "offset", offset: -5 }],
    });

    // a primitive reading is one not wrapped in an object
    const transformed = await module.runAllTransformations(5);
    expect(transformed).to.deep.equal(0);
  });

  it("works on simple readings", async function () {
    const module = new Module({
      transformations: [{ type: "offset", path: "temp", offset: -5 }],
    });

    // a simple reading is one with only one key/value pair in it
    const transformed = await module.runAllTransformations({ temp: 5 });
    expect(transformed).to.deep.equal({ temp: 0 });
  });

  it("works on composite readings", async function () {
    const module = new Module({
      transformations: [
        {
          type: "offset",
          paths: { temp: { offset: -5 }, humidity: { offset: 10 } },
        },
      ],
    });

    // a composite reading is one with multiple key/value pairs in it
    const transformed = await module.runAllTransformations({
      temp: 5,
      humidity: 30,
    });
    expect(transformed).to.deep.equal({ temp: 0, humidity: 40 });
  });

  it("works on arrays of primitive readings", async function () {
    const module = new Module({
      transformations: [{ type: "offset", offset: -5 }],
    });

    // a primitive reading is one not wrapped in an object
    const transformed = await module.runAllTransformations([1, 2, 3, 4, 5]);
    expect(transformed).to.deep.equal([-4, -3, -2, -1, 0]);
  });

  it("works on arrays of primitive readings with a base path", async function () {
    const module = new Module({
      transformations: [{ type: "offset", offset: -5, basePath: "weather" }],
    });

    // a primitive reading is one not wrapped in an object
    const transformed = await module.runAllTransformations({
      weather: [1, 2, 3, 4, 5],
    });
    expect(transformed).to.deep.equal({ weather: [-4, -3, -2, -1, 0] });
  });

  it("works on arrays of simple readings", async function () {
    const module = new Module({
      transformations: [{ type: "offset", path: "temp", offset: -5 }],
    });

    // a simple reading is one with only one key/value pair in it
    const transformed = await module.runAllTransformations([
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
    const module = new Module({
      transformations: [
        { type: "offset", basePath: "weather", path: "temp", offset: -5 },
      ],
    });

    // a simple reading is one with only one key/value pair in it
    const transformed = await module.runAllTransformations({
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
    const module = new Module({
      transformations: [
        {
          type: "offset",
          paths: { temp: { offset: -5 }, humidity: { offset: -10 } },
        },
      ],
    });

    // a composite reading is one with only one key/value pair in it
    const transformed = await module.runAllTransformations([
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
    const module = new Module({
      transformations: [
        {
          type: "offset",
          basePath: "weather",
          paths: { temp: { offset: -5 }, humidity: { offset: 1 } },
        },
      ],
    });

    // a composite reading is one with only one key/value pair in it
    const transformed = await module.runAllTransformations({
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
