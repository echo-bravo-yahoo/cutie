import { describe, it, before } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { setGlobals } from "../../src/index.js";

import { OnceConfig } from "../../src/triggers/once.js";

describe("triggers", function () {
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

  describe("specific triggers", function () {
    describe("once", function () {
      it("interpolates the provided message", async function () {
        const task = new Task(
          {
            steps: [{ type: "output:console" }],
            trigger: {
              type: "trigger:once",
              message: "hello ${env.name}",
            } as OnceConfig,
          },
          "interpolates the provided message",
        );
        task.trigger?.startMessage(undefined, undefined);

        // a primitive reading is one not wrapped in an object
        // const transformed = await task.startMessage(5);
        // expect(transformed).to.deep.equal("hello world");
      });
    });
  });
});
