import { after, before, describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { Globals, globals, setGlobals } from "../../src/index.js";
import Task from "../../src/util/Task.js";
import { validateConfig } from "../../src/util/validate.js";
import { createMqttMock } from "../helpers.js";

const fakeLogger = {
  emit: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logListeners: [] as Array<unknown>,
  logger: {
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => fakeLogger,
  },
};

function taskWith(steps: Array<any>, name: string) {
  return new Task({ steps }, name);
}

async function errorsFor(step: object, connections: Array<object> = []) {
  return validateConfig(
    { connections, tasks: { t: { steps: [step] } } },
    { configPath: "/tmp/x.json" },
  );
}

describe("outputs", function () {
  // "mqtt" can only be mocked once per process, so every test that needs a
  // broker shares this one.
  const broker = createMqttMock();
  let directory: string;

  before(async function () {
    mock.module("mqtt", { defaultExport: broker.mqtt });
    directory = await mkdtemp(join(tmpdir(), "cutie-outputs-"));
    setGlobals({
      tasks: [],
      connections: [],
      version: "test",
      logger: fakeLogger,
      eventBus: new EventEmitter(),
      configDir: directory,
    } as unknown as Globals);
  });

  after(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  describe("output:mqtt", function () {
    const connection = {
      type: "connection:mqtt",
      name: "broker",
      endpoint: "mqtt://127.0.0.1:1883",
    };

    async function publishing(extra: object, message: unknown) {
      const { registerConnections } = await import(
        "../../src/util/connections.js"
      );
      globals.connections = [];
      await registerConnections([connection as never]);

      const task = taskWith(
        [
          {
            type: "output:mqtt",
            connectionName: "broker",
            topics: ["out/topic"],
            ...extra,
          },
        ],
        "publishes",
      );
      await task.register();
      const client = broker.clients[broker.clients.length - 1];
      const published: Array<{
        topic: string;
        payload: string;
        options: never;
      }> = [];
      client.publishAsync = async (
        topic: string,
        payload: unknown,
        options: never,
      ) => {
        published.push({ topic, payload: String(payload), options });
      };

      await task.startMessage(message as never);

      return published;
    }

    // `topic` shipped as a working shorthand, so it is deprecated rather than
    // rejected: accepted with one warning and normalized onto `topics`.
    it("accepts a single topic as a deprecated alias", async function () {
      const errors = await errorsFor(
        {
          type: "output:mqtt",
          connectionName: "broker",
          topic: "out/topic",
        },
        [connection],
      );

      expect(errors).to.deep.equal([
        {
          severity: "warning",
          path: "tasks.t.steps[0].topic",
          message: 'deprecated; use "topics" instead',
        },
      ]);
    });

    it("normalizes that alias onto a single-element topics", async function () {
      const task = new Task({ steps: [] }, "normalizes topic");
      const step = await task.importStep(
        {
          type: "output:mqtt",
          connectionName: "broker",
          topic: "out/topic",
        } as never,
        0,
      );

      expect((step.config as { topics: Array<string> }).topics).to.deep.equal([
        "out/topic",
      ]);
    });

    it("is rejected when it names both a topic and topics", async function () {
      const errors = await errorsFor(
        {
          type: "output:mqtt",
          connectionName: "broker",
          topic: "a",
          topics: ["b"],
        },
        [connection],
      );

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].topic",
        message: 'cannot be combined with "topics"',
      });
    });

    it("is rejected when it names no topics at all", async function () {
      const errors = await errorsFor(
        { type: "output:mqtt", connectionName: "broker" },
        [connection],
      );

      expect(errors.map((entry) => entry.path)).to.include(
        "tasks.t.steps[0].topics",
      );
    });

    it("passes retain and qos through to the client", async function () {
      const published = await publishing({ retain: true, qos: 1 }, { a: 1 });

      expect(published).to.have.lengthOf(1);
      expect(published[0].options).to.deep.equal({ retain: true, qos: 1 });
    });

    it("does not retain by default", async function () {
      const published = await publishing({}, { a: 1 });

      expect(published[0].options).to.deep.equal({ retain: false, qos: 0 });
    });

    it("rejects a qos outside 0 to 2", async function () {
      const errors = await errorsFor(
        {
          type: "output:mqtt",
          connectionName: "broker",
          topics: ["t"],
          qos: 3,
        },
        [connection],
      );

      expect(errors).to.deep.include({
        severity: "error",
        path: "tasks.t.steps[0].qos",
        message: "3 is out of range; expected 0 to 2",
      });
    });

    it("publishes a raw string without surrounding quotes", async function () {
      const published = await publishing({ raw: true }, "already text");

      expect(published[0].payload).to.equal("already text");
    });

    it("still encodes an object when raw is set", async function () {
      const published = await publishing({ raw: true }, { a: 1 });

      expect(published[0].payload).to.equal('{"a":1}');
    });

    it("quotes a string when raw is not set", async function () {
      const published = await publishing({}, "already text");

      expect(published[0].payload).to.equal('"already text"');
    });

    it("resolves only once the publish has settled", async function () {
      const { registerConnections } = await import(
        "../../src/util/connections.js"
      );
      globals.connections = [];
      await registerConnections([connection as never]);

      const task = taskWith(
        [
          {
            type: "output:mqtt",
            connectionName: "broker",
            topics: ["out/topic"],
          },
        ],
        "awaits the publish",
      );
      await task.register();

      let settled = false;
      const client = broker.clients[broker.clients.length - 1];
      client.publishAsync = () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 5),
        );

      await task.startMessage({ a: 1 });

      expect(settled).to.equal(true);
    });
  });

  describe("output:switchbots", function () {
    it("rejects the old bots key, naming devices", async function () {
      const errors = await errorsFor({
        type: "output:switchbots",
        bots: [{ id: "aa", name: "kitchen" }],
      });

      expect(errors.map((entry) => entry.path)).to.include(
        "tasks.t.steps[0].devices",
      );
      expect(
        errors.some((entry) => entry.path === "tasks.t.steps[0].bots"),
      ).to.equal(true);
    });

    it("rejects a devices entry using id or name", async function () {
      for (const [old, current] of [
        ["id", "address"],
        ["name", "label"],
      ] as const) {
        await expect(
          taskWith(
            [
              {
                type: "output:switchbots",
                devices: [{ [old]: "aa:bb", address: "aa:bb" }],
              },
            ],
            `switchbots with ${old}`,
          ).register(),
          old,
        ).to.be.rejectedWith(
          new RegExp(`does not accept "${old}"; use "${current}" instead`),
        );
      }
    });

    // Built rather than registered: enable() would start a real Bluetooth scan,
    // and what matters here is that a message finds its configured device.
    it("routes a message to the device with the matching address", async function () {
      const task = new Task({ steps: [] }, "routes to a device");
      const step = (await task.importStep(
        {
          type: "output:switchbots",
          devices: [{ address: "aa:bb", label: "kitchen" }],
        } as never,
        0,
      )) as unknown as {
        devices: Record<string, unknown>;
        send: (message: unknown) => Promise<unknown>;
      };

      const pressed: Array<string> = [];
      step.devices["aa:bb"] = {
        press: async () => pressed.push("press"),
        handUp: async () => pressed.push("handUp"),
        handDown: async () => pressed.push("handDown"),
      };

      await step.send({ id: "aa:bb", action: "press" });
      await step.send({ id: "aa:bb", action: "on" });

      expect(pressed).to.deep.equal(["press", "handDown"]);
    });

    it("reports an address it has no configuration for", async function () {
      const task = new Task({ steps: [] }, "unknown address");
      const step = (await task.importStep(
        {
          type: "output:switchbots",
          devices: [{ address: "aa:bb", label: "kitchen" }],
        } as never,
        0,
      )) as unknown as { send: (message: unknown) => Promise<unknown> };

      await expect(
        step.send({ id: "cc:dd", action: "press" }),
      ).to.be.rejectedWith(/No switchbot configured with address "cc:dd"/);
    });
  });

  describe("output:thermal-printer", function () {
    it("rejects the old path key, naming devicePath", async function () {
      await expect(
        taskWith(
          [{ type: "output:thermal-printer", path: "/dev/ttyS0" }],
          "printer with path",
        ).register(),
      ).to.be.rejectedWith(/does not accept "path"; use "devicePath"/);
    });

    // Required only when a real printer is driven, which is a pairing the
    // schema cannot express, so register() enforces it instead.
    it("requires a devicePath unless it is virtual", async function () {
      await expect(
        taskWith(
          [{ type: "output:thermal-printer" }],
          "printer with no path",
        ).register(),
      ).to.be.rejectedWith(/needs a "devicePath"/);
    });

    it("needs no devicePath when it is virtual", async function () {
      await taskWith(
        [{ type: "output:thermal-printer", virtual: true }],
        "virtual printer",
      ).register();
    });

    // The vendor library reads this with `||`, so its own default only applies
    // when the key is absent rather than undefined.
    it("leaves chineseFirmware out of the resolved config unless set", async function () {
      const task = new Task({ steps: [] }, "printer defaults");
      const step = await task.importStep(
        { type: "output:thermal-printer", devicePath: "/dev/null" } as never,
        0,
      );

      expect("chineseFirmware" in (step.config as object)).to.equal(false);
    });
  });

  describe("output:file", function () {
    async function writeThrough(messages: Array<unknown>, name: string) {
      const path = join(directory, `${name}.log`);
      const task = taskWith(
        [{ type: "output:file", path, append: true, insertNewlines: true }],
        name,
      );
      await task.register();

      for (const message of messages) await task.startMessage(message as never);

      return readFile(path, { encoding: "utf8" });
    }

    it("ends a message with a newline rather than starting one", async function () {
      expect(await writeThrough(["one"], "one-line")).to.equal("one\n");
    });

    it("gives two messages two complete lines and a trailing newline", async function () {
      const written = await writeThrough(["one", "two"], "two-lines");

      expect(written).to.equal("one\ntwo\n");
      expect(written.split("\n").slice(0, 2)).to.deep.equal(["one", "two"]);
    });
  });

  describe("output:nec", function () {
    // Same pairing as the thermal printer's devicePath: a pin is only needed
    // when one is actually driven, so register() enforces it.
    it("requires a ledPin unless it is virtual", async function () {
      await expect(
        taskWith([{ type: "output:nec" }], "nec with no pin").register(),
      ).to.be.rejectedWith(/needs a "ledPin"/);
    });

    it("registers with a ledPin", async function () {
      expect(
        await errorsFor({ type: "output:nec", ledPin: 23, virtual: true }),
      ).to.deep.equal([]);
    });
  });
});
