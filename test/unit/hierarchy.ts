import { describe, it, before, after } from "node:test";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { setGlobals } from "../../src/index.js";
import Step from "../../src/util/Step.js";
import Task from "../../src/util/Task.js";
import TaskModule from "../../src/util/TaskModule.js";
import Trigger from "../../src/util/Trigger.js";

describe("the configurable hierarchy", function () {
  const fakeLogger = {
    emit: () => {},
    logListeners: [] as Array<unknown>,
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  before(() => {
    setGlobals({ logger: fakeLogger, configDir: process.cwd() } as any);
  });

  async function registered(config: object, name: string) {
    const task = new Task(config, name);
    await task.register();

    return task;
  }

  describe("a trigger", function () {
    it("is a TaskModule but not a Step", async function () {
      const task = await registered(
        { trigger: { type: "trigger:once", message: "hi" }, steps: [] },
        "trigger is not a step",
      );

      expect(task.trigger).to.be.an.instanceOf(Trigger);
      expect(task.trigger).to.be.an.instanceOf(TaskModule);
      expect(task.trigger).to.not.be.an.instanceOf(Step);
    });

    it("has no chain surface to inherit", async function () {
      const task = await registered(
        { trigger: { type: "trigger:once", message: "hi" }, steps: [] },
        "trigger has no chain",
      );
      const trigger = task.trigger as unknown as Record<string, unknown>;

      for (const member of ["next", "handleMessage", "doHandleMessage"])
        expect(trigger[member], member).to.equal(undefined);
    });

    it("still interpolates its configured message", async function () {
      const previous = process.env.cutieTestGreeting;
      process.env.cutieTestGreeting = "world";

      try {
        const task = await registered(
          {
            trigger: {
              type: "trigger:repeat",
              interval: "1h",
              message: "${task.name} says hello ${env.cutieTestGreeting}",
            },
            steps: [],
          },
          "greeter",
        );
        const trigger = task.trigger as unknown as {
          interpolateDeep: (value: unknown) => unknown;
          config: { message: string };
        };

        expect(trigger.interpolateDeep(trigger.config.message)).to.equal(
          "greeter says hello world",
        );

        await task.trigger!.disable();
      } finally {
        process.env.cutieTestGreeting = previous;
      }
    });

    it("is disabled along with its task", async function () {
      const task = await registered(
        {
          disabled: true,
          trigger: { type: "trigger:repeat", interval: "1h", message: "tick" },
          steps: [],
        },
        "disabled task",
      );

      expect(task.trigger!.shouldEnable()).to.equal(false);
      expect(task.trigger!.enabled).to.equal(false);
    });

    it("is rejected in a step slot", async function () {
      const task = new Task(
        { steps: [{ type: "trigger:once", message: "hi" } as never] },
        "trigger in a step slot",
      );

      await expect(task.register()).to.be.rejectedWith(
        "Triggers cannot be specified as a step.",
      );
    });
  });

  describe("a step", function () {
    const cases = [
      { title: "read", config: { type: "read:constant", value: 1 } },
      { title: "transform", config: { type: "transform:prettify" } },
      { title: "output", config: { type: "output:console" } },
    ];

    for (const { title, config } of cases) {
      it(`is a Step when it is a ${title}`, async function () {
        const task = await registered(
          { steps: [config] },
          `${title} is a step`,
        );

        expect(task.steps[0]).to.be.an.instanceOf(Step);
        expect(task.steps[0]).to.be.an.instanceOf(TaskModule);
        expect(task.steps[0]).to.not.be.an.instanceOf(Trigger);
      });
    }

    it("is disabled along with its task", async function () {
      const task = await registered(
        { disabled: true, steps: [{ type: "output:console" }] },
        "disabled task with a step",
      );

      expect(task.steps).to.have.lengthOf(0);
    });
  });

  after(() => {
    setGlobals(undefined as any);
  });
});
