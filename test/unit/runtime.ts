import { describe, it, before } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { globals, setGlobals } from "../../src/index.js";
import Sensor from "../../src/util/Sensor.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import { registerConnections } from "../../src/util/connections.js";
import { redact } from "../../src/util/redact.js";
import { CronConfig } from "../../src/triggers/cron.js";
import { EventConfig } from "../../src/triggers/event.js";
import { taskDone } from "../helpers.js";

// A connection with a stubbed-out client, so subscribe/unsubscribe
// bookkeeping can be observed without a broker.
function stubbedConnection() {
  const connection = new MQTTConnection({
    type: "connection:mqtt",
    name: "stub",
    endpoint: "mqtt://127.0.0.1:1883",
  } as any);
  const subscribed: Array<Array<string>> = [];
  const unsubscribed: Array<Array<string>> = [];

  connection.connection = {
    subscribeAsync: async (topics: Array<string>) => subscribed.push(topics),
    unsubscribeAsync: async (topics: Array<string>) =>
      unsubscribed.push(topics),
  } as any;
  connection.enabled = true;

  return { connection, subscribed, unsubscribed };
}

describe("the runtime", function () {
  const fakeLogger = {
    emit: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logger: {
      info: () => {},
      debug: () => {},
      child: () => fakeLogger,
    },
  };

  before(() => {
    setGlobals({
      logger: fakeLogger,
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as any);
  });

  describe("trigger:cron", function () {
    it("fires more than once", async function () {
      const task = new Task(
        {
          steps: [{ type: "output:stash", key: "last", value: "tick" }],
          trigger: {
            type: "trigger:cron",
            // once per second, so the repeat is observable in a unit test
            expression: "* * * * * *",
            message: "tick",
          } as CronConfig,
        },
        "cron fires more than once",
      );

      await task.register();
      await taskDone(task, { timeout: 4000, waitFor: 2 });
      await task.trigger!.disable();

      expect(task.messagesHandled).to.be.at.least(2);
    });
  });

  describe("trigger:event", function () {
    it("stops listening when disabled", async function () {
      const task = new Task(
        {
          steps: [{ type: "output:stash", key: "last", value: "fired" }],
          trigger: {
            type: "trigger:event",
            key: "a-happening",
          } as EventConfig,
        },
        "event unsubscribes on disable",
      );

      await task.register();
      expect(globals.eventBus.listenerCount("a-happening")).to.equal(1);

      await task.trigger!.disable();
      expect(globals.eventBus.listenerCount("a-happening")).to.equal(0);
    });
  });

  describe("MQTTConnection.matchesTopic", function () {
    it("matches a single wildcard filter given as a string", function () {
      expect(
        MQTTConnection.matchesTopic("development/thing", "development/+"),
      ).to.equal(true);
    });

    it("matches a wildcard filter given in an array", function () {
      expect(
        MQTTConnection.matchesTopic("development/thing", [
          "unrelated/+",
          "development/+",
        ]),
      ).to.equal(true);
    });

    it("matches a multi-level wildcard", function () {
      expect(MQTTConnection.matchesTopic("a/b/c/d", "a/#")).to.equal(true);
    });

    it("does not match an unrelated filter", function () {
      expect(MQTTConnection.matchesTopic("development/thing", "prod/+")).to.equal(
        false,
      );
    });
  });

  describe("MQTT topic subscriptions", function () {
    it("only unsubscribes once the last subscriber goes away", async function () {
      const { connection, subscribed, unsubscribed } = stubbedConnection();

      await connection.subscribe("shared/topic");
      await connection.subscribe("shared/topic");
      expect(subscribed).to.deep.equal([["shared/topic"]]);

      await connection.unsubscribe("shared/topic");
      expect(unsubscribed).to.deep.equal([]);

      await connection.unsubscribe("shared/topic");
      expect(unsubscribed).to.deep.equal([["shared/topic"]]);
    });

    it("subscribes each distinct topic once", async function () {
      const { connection, subscribed } = stubbedConnection();

      await connection.subscribe(["a/one", "a/two"]);
      await connection.subscribe(["a/two", "a/three"]);

      expect(subscribed).to.deep.equal([
        ["a/one", "a/two"],
        ["a/three"],
      ]);
    });
  });

  describe("Sensor.doAggregation", function () {
    it("sums", function () {
      expect(Sensor.doAggregation([1, 2, 3], "sum")).to.equal(6);
    });

    it("takes a median of an odd-length set", function () {
      expect(Sensor.doAggregation([3, 1, 2], "median")).to.equal(2);
    });

    it("interpolates a median of an even-length set", function () {
      expect(Sensor.doAggregation([1, 2, 3, 4], "median")).to.equal(2.5);
    });

    it("treats median as p50", function () {
      expect(Sensor.doAggregation([1, 2, 3, 4], "p50")).to.equal(
        Sensor.doAggregation([1, 2, 3, 4], "median"),
      );
    });

    it("interpolates an arbitrary percentile", function () {
      // rank = 0.95 * 9 = 8.55, between the 9th and 10th values
      expect(
        Sensor.doAggregation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "p95"),
      ).to.be.closeTo(9.55, 1e-9);
    });

    it("accepts fractional percentiles", function () {
      expect(
        Sensor.doAggregation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "p99.5"),
      ).to.be.closeTo(9.955, 1e-9);
    });

    it("bounds p0 and p100 to the extremes", function () {
      expect(Sensor.doAggregation([5, 1, 9], "p0")).to.equal(1);
      expect(Sensor.doAggregation([5, 1, 9], "p100")).to.equal(9);
    });

    it("still supports latest and average", function () {
      expect(Sensor.doAggregation([1, 2, 3], "latest")).to.equal(3);
      expect(Sensor.doAggregation([1, 2, 3], "average")).to.equal(2);
    });

    it("reads through a path", function () {
      const samples = [{ v: 1 }, { v: 3 }, { v: 5 }] as any;
      expect(Sensor.doAggregation(samples, "sum", "v")).to.equal(9);
      expect(Sensor.doAggregation(samples, "median", "v")).to.equal(3);
    });

    it("collapses a single datapoint to latest regardless of aggregation", function () {
      expect(Sensor.doAggregation([7], "sum")).to.equal(7);
    });

    it("throws on an unsupported aggregation", function () {
      expect(() => Sensor.doAggregation([1, 2], "nonsense")).to.throw(
        /Unsupported aggregation/,
      );
    });

    it("throws on an out-of-range percentile", function () {
      expect(() => Sensor.doAggregation([1, 2], "p101")).to.throw(
        /Unsupported aggregation/,
      );
    });
  });

  describe("output:stash", function () {
    async function stashValue(value: unknown, message: unknown = "a message") {
      const task = new Task(
        {
          steps: [{ type: "output:stash", key: "stashed", value } as any],
        },
        "stashes a value",
      );
      await task.register();
      await task.startMessage(message as any);

      return task.stash!.stashed;
    }

    it("stashes a number without stringifying it", async function () {
      expect(await stashValue(42)).to.equal(42);
    });

    it("stashes an object without stringifying it", async function () {
      expect(await stashValue({ a: 1, b: [2, 3] })).to.deep.equal({
        a: 1,
        b: [2, 3],
      });
    });

    it("stashes a boolean without stringifying it", async function () {
      expect(await stashValue(false)).to.equal(false);
    });

    it("interpolates a string value", async function () {
      expect(await stashValue("hello ${message}", "world")).to.equal(
        "hello world",
      );
    });
  });

  describe("credential redaction", function () {
    it("leaves no password, username, or token in what registerConnections emits", async function () {
      const emitted: Array<unknown> = [];
      const capturingLogger = {
        ...fakeLogger,
        emit: (
          _message: string,
          _verbosity: string,
          _topic: string,
          object?: object,
        ) => {
          if (object) emitted.push(object);
        },
      };
      setGlobals({
        logger: capturingLogger,
        connections: [],
        tasks: [],
        eventBus: new EventEmitter(),
      } as any);

      // The InfluxDB connection opens no socket on register, so this exercises
      // registration without needing a live server.
      await registerConnections([
        {
          type: "connection:influxdb",
          name: "influx",
          url: "http://127.0.0.1:8086/api/v2/write",
          organization: "home",
          bucket: "sensors",
          token: "SUPERSECRETTOKEN",
          password: "SUPERSECRETPW",
          username: "SUPERSECRETUSER",
          precision: "ns",
        } as any,
      ]);

      const serialized = JSON.stringify(emitted);
      expect(emitted.length).to.be.greaterThan(0);
      expect(serialized).to.not.include("SUPERSECRETTOKEN");
      expect(serialized).to.not.include("SUPERSECRETPW");
      expect(serialized).to.not.include("SUPERSECRETUSER");
      // The non-secret fields still come through, so this is redaction rather
      // than the whole object going missing.
      expect(serialized).to.include("influx");

      setGlobals({
        logger: fakeLogger,
        connections: [],
        tasks: [],
        eventBus: new EventEmitter(),
      } as any);
    });

    it("redacts secrets nested inside a whole config file", function () {
      const redacted = redact({
        connections: [
          { name: "a", password: "pw", token: "tok", endpoint: "mqtt://x" },
        ],
        tasks: {},
      });

      expect(redacted.connections[0].password).to.equal("[redacted]");
      expect(redacted.connections[0].token).to.equal("[redacted]");
      expect(redacted.connections[0].endpoint).to.equal("mqtt://x");
    });

    it("does not mutate the config it redacts", function () {
      const original = { connections: [{ password: "pw" }] };
      redact(original);

      expect(original.connections[0].password).to.equal("pw");
    });
  });
});
