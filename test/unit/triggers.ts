import { describe, it, before, after } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { setGlobals } from "../../src/index.js";

import { OnceConfig } from "../../src/triggers/once.js";
import { taskDone } from "../helpers.js";

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
      let nameEnvVariable: string | undefined;

      before(() => {
        nameEnvVariable = process.env.name;
        process.env.name = "world";
      });

      after(() => {
        process.env.name = nameEnvVariable;
        (console.log as unknown as it.Mock<any>).mock.restore();
      });

      it("interpolates the provided message", async function (context) {
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
        console.log = context.mock.fn(console.log, () => {}, { times: 1 });

        await task.register();
        await taskDone(task);

        expect(
          (console.log as unknown as it.Mock<any>).mock.calls[0].arguments[0],
        ).to.equal("hello world");
      });
    });
  });
});
