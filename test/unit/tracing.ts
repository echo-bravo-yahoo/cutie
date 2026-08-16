import { describe, it, before, beforeEach, afterEach } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import Task from "../../src/util/Task.js";
import { globals, setGlobals } from "../../src/index.js";
import MQTTConnection from "../../src/connections/mqtt.js";
import MQTTOutput from "../../src/outputs/mqtt.js";
import { Configurable } from "../../src/util/Configurable.js";
import LogHelper, { SerializedLogLine } from "../../src/util/LogHelper.js";
import { Verbosity } from "../../src/triggers/logs.js";
import {
  fromTraceparent,
  newTraceId,
  toTraceparent,
} from "../../src/util/trace.js";
import { createMqttMock, taskDone } from "../helpers.js";

// The wire format the whole feature is chosen for: version 00, a 32-character
// trace-id, a 16-character parent-id, and the sampled flag.
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
// A uuid v7 specifically -- the "7" and the variant nibble -- because it is
// v7's time-ordering that made it the trace-id source.
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VERBOSITIES: Array<Verbosity> = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

// A connection with a stubbed-out client, so a message can be driven into
// handleMessage without a broker.
function stubbedConnection() {
  const connection = new MQTTConnection({
    type: "connection:mqtt",
    name: "stub",
    endpoint: "mqtt://127.0.0.1:1883",
  } as any);

  connection.connection = {
    options: { clientId: "stub_client" },
    subscribeAsync: async () => {},
    unsubscribeAsync: async () => {},
  } as any;
  connection.enabled = true;

  return { connection };
}

describe("tracing", function () {
  const fakeLogger = {
    logListeners: [] as Array<unknown>,
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

  // The prefix a hypothetical trigger:logs task would log under, so the
  // recursion guard has something to recognize.
  const LISTENER_PREFIX = "core.runtime.tasks.a logs task";
  const HANDLED = /Handled message in \d+(\.\d+)?ms\./;

  const captured: Array<{ line: SerializedLogLine; traceId?: string }> = [];
  const warnings: Array<string> = [];
  // What pino would have written; captured rather than let out to stdout in
  // the middle of the test report, and read back by the output:logs tests.
  const printed: Array<{ verbosity: Verbosity; log: string }> = [];
  const logger = new LogHelper();

  // shouldEmit, task.logPrefix and startMessage are the whole interface
  // LogHelper.emit uses of a listener.
  const listener = {
    shouldEmit: () => true,
    task: { logPrefix: LISTENER_PREFIX },
    startMessage: (line: SerializedLogLine, traceId?: string) =>
      captured.push({ line, traceId }),
  } as any;

  for (const verbosity of VERBOSITIES) {
    logger[verbosity] = (log: string) => {
      printed.push({ verbosity, log });
      if (verbosity === "warn") warnings.push(log);
    };
  }

  // A second listener, for the tests that care about how a line fans out.
  function extraListener(prefix: string, shouldEmit: () => boolean = () => true) {
    const seen: Array<{ line: SerializedLogLine; traceId?: string }> = [];
    const extra = {
      shouldEmit,
      task: { logPrefix: prefix },
      startMessage: (line: SerializedLogLine, traceId?: string) =>
        seen.push({ line, traceId }),
    } as any;

    return { listener: extra, seen };
  }

  function linesMatching(pattern: string | RegExp) {
    return captured.filter(({ line }) =>
      typeof pattern === "string"
        ? line.log.includes(pattern)
        : pattern.test(line.log),
    );
  }

  function timedTopics() {
    return linesMatching(HANDLED)
      .map(({ line }) => line.topic)
      .sort();
  }

  // A task and its steps log as they register, and those lines belong to no
  // message, so a test only looks at what it produced itself.
  function forgetRegistrationLines() {
    captured.length = 0;
  }

  async function tracedTask(name: string) {
    const task = new Task(
      {
        steps: [
          { type: "read:constant", value: { temp: 21.005 } } as any,
          { type: "transform:round", path: "temp", precision: 1 } as any,
          {
            type: "output:stash",
            key: "reading",
            value: "${message.temp}",
          } as any,
        ],
      },
      name,
    );
    await task.register();

    return task;
  }

  // A task whose trigger is an mqtt topic on the named connection.
  async function subscribingTask(name: string, topic: string) {
    const task = new Task(
      {
        trigger: {
          type: "trigger:mqtt",
          connectionName: "stub",
          topic,
        } as any,
        steps: [{ type: "output:stash", key: "received", value: "yes" } as any],
      },
      name,
    );
    await task.register();
    globals.tasks.push(task);

    return task;
  }

  // A connection wired to the in-memory broker, so a publish really comes
  // back through handleMessage. register() is not usable here: it imports
  // mqtt itself, which is already loaded by the time a test runs.
  async function brokeredConnection(protocolVersion?: number) {
    const { mqtt } = createMqttMock();
    const connection = new MQTTConnection({
      type: "connection:mqtt",
      name: "broker",
      endpoint: "mqtt://127.0.0.1:1883",
      protocolVersion,
    } as any);

    connection.connection = (await mqtt.connectAsync("mqtt://127.0.0.1:1883", {
      protocolVersion,
    })) as any;
    connection.connection.on(
      "message",
      connection.handleMessage.bind(connection),
    );
    connection.enabled = true;
    globals.connections.push(connection);

    // A v5 user property only exists on the packet, so the published wire
    // format is read back from what the subscriber was handed.
    const packets: Array<any> = [];
    connection.connection.on("message", (_topic, _payload, packet) =>
      packets.push(packet),
    );

    return { connection, packets };
  }

  // Publishes one message through the broker and back into a second task,
  // which is the shape examples/remote-clock.yaml describes.
  async function roundTrip(propagateTrace: boolean, protocolVersion?: number) {
    const { packets } = await brokeredConnection(protocolVersion);

    const publisher = new Task(
      {
        steps: [
          {
            type: "output:mqtt",
            connectionName: "broker",
            topics: ["trace/roundtrip"],
            propagateTrace,
          } as any,
        ],
      },
      "publishes over mqtt",
    );
    const subscriber = new Task(
      {
        trigger: {
          type: "trigger:mqtt",
          connectionName: "broker",
          topic: "trace/roundtrip",
        } as any,
        steps: [{ type: "output:stash", key: "received", value: "yes" } as any],
      },
      "receives over mqtt",
    );

    await publisher.register();
    await subscriber.register();
    globals.tasks.push(publisher, subscriber);
    forgetRegistrationLines();

    const traceId = newTraceId();
    await publisher.startMessage("tick", traceId);
    await taskDone(subscriber);

    return { traceId, publisher, subscriber, packets };
  }

  before(() => {
    setGlobals({
      logger: fakeLogger,
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as any);
  });

  beforeEach(function () {
    captured.length = 0;
    warnings.length = 0;
    printed.length = 0;
    logger.logListeners = [listener];
    setGlobals({ ...globals, logger } as any);
  });

  afterEach(function () {
    globals.tasks.length = 0;
    globals.connections.length = 0;
    setGlobals({ ...globals, logger: fakeLogger } as any);
  });

  describe("traceparent encoding", function () {
    it("encodes a trace as a W3C traceparent", function () {
      expect(toTraceparent(newTraceId())).to.match(TRACEPARENT);
    });

    it("uses the trace as the trace-id field, dashes stripped", function () {
      const traceId = newTraceId();

      expect(toTraceparent(traceId).split("-")[1]).to.equal(
        traceId.replace(/-/g, ""),
      );
    });

    it("gives each publish its own parent-id under one trace-id", function () {
      const traceId = newTraceId();
      const first = toTraceparent(traceId).split("-");
      const second = toTraceparent(traceId).split("-");

      expect(first[1]).to.equal(second[1]);
      expect(first[2]).to.not.equal(second[2]);
    });

    it("round trips a trace through the header and back", function () {
      const traceId = newTraceId();

      expect(fromTraceparent(toTraceparent(traceId))).to.equal(traceId);
    });

    it("rejects a header that is empty or not a traceparent at all", function () {
      expect(fromTraceparent("")).to.equal(undefined);
      expect(fromTraceparent("garbage")).to.equal(undefined);
    });

    it("rejects an all-zero trace-id, which the spec forbids", function () {
      const header = `00-${"0".repeat(32)}-${"a".repeat(16)}-01`;

      expect(header).to.match(TRACEPARENT);
      expect(fromTraceparent(header)).to.equal(undefined);
    });

    it("rejects a version it does not know", function () {
      expect(fromTraceparent(`01-${"a".repeat(32)}-${"b".repeat(16)}-01`)).to.equal(
        undefined,
      );
    });

    it("rejects a mis-sized trace-id or parent-id", function () {
      expect(fromTraceparent(`00-${"a".repeat(31)}-${"b".repeat(16)}-01`)).to.equal(
        undefined,
      );
      expect(fromTraceparent(`00-${"a".repeat(32)}-${"b".repeat(15)}-01`)).to.equal(
        undefined,
      );
    });

    it("rejects uppercase hex, which the spec forbids", function () {
      expect(fromTraceparent(`00-${"A".repeat(32)}-${"b".repeat(16)}-01`)).to.equal(
        undefined,
      );
    });

    it("mints a uuid v7, whose ordering is why it was chosen", function () {
      expect(newTraceId()).to.match(UUID_V7);
    });
  });

  it("puts the trace on every line a message produces", async function () {
    const task = await tracedTask("traces every line");
    forgetRegistrationLines();

    await task.startMessage("start", "a-known-trace");

    expect(captured.length).to.be.greaterThan(0);
    for (const { line } of captured) {
      expect(line.traceId, line.log).to.equal("a-known-trace");
      expect(line.log, "the rendered line").to.include("(a-known-trace)");
    }
    expect(linesMatching("Stashing value under key")).to.have.lengthOf(1);
  });

  it("times every step and the message as a whole", async function () {
    const task = await tracedTask("times every step");
    forgetRegistrationLines();

    await task.startMessage("start", "a-timed-trace");

    // one line per step, under that step's own topic, plus the task's total
    expect(timedTopics()).to.deep.equal([
      task.logPrefix,
      `${task.logPrefix}.steps.0`,
      `${task.logPrefix}.steps.1`,
      `${task.logPrefix}.steps.2`,
    ]);
  });

  it("says on each timing line what it timed", async function () {
    const task = await tracedTask("labels every timing line");
    forgetRegistrationLines();

    await task.startMessage("start", "a-labelled-trace");

    const timed = linesMatching(HANDLED);
    const step = timed.find(({ line }) => line.topic.endsWith(".steps.1"));
    const total = timed.find(({ line }) => line.topic === task.logPrefix);

    expect(step!.line.object).to.deep.equal({ type: "transform:round" });
    expect(total!.line.object).to.deep.equal({ steps: 3 });
  });

  it("hands a listener the trace both to route on and to continue", function () {
    const configurable = new Configurable({}, "logs with a trace");
    configurable.debug("a traced line", {
      topic: "core.custom",
      traceId: "a-dispatched-trace",
    });

    expect(captured).to.have.lengthOf(1);
    expect(captured[0].line.traceId).to.equal("a-dispatched-trace");
    expect(captured[0].traceId).to.equal("a-dispatched-trace");
  });

  it("does not dispatch a line a listener's own task logged", function () {
    const configurable = new Configurable({}, "logs about logging");

    configurable.debug("from the logs task's step", {
      topic: `${LISTENER_PREFIX}.steps.0`,
    });
    configurable.debug("from the logs task itself", {
      topic: LISTENER_PREFIX,
    });
    configurable.debug("from a task whose name merely starts the same", {
      topic: `${LISTENER_PREFIX}2.steps.0`,
    });

    expect(captured).to.have.lengthOf(1);
    expect(captured[0].line.log).to.include("merely starts the same");
  });

  it("shares one trace between an arriving mqtt message and the task it starts", async function () {
    const { connection } = stubbedConnection();
    globals.connections.push(connection);

    const task = await subscribingTask("receives an mqtt message", "some/topic");
    forgetRegistrationLines();

    connection.handleMessage("some/topic", Buffer.from("42"), {} as any);
    await taskDone(task);

    const [ingress] = linesMatching("Received new message on topic");
    const [stashed] = linesMatching("Stashing value under key");

    expect(ingress.line.traceId).to.be.a("string");
    expect(stashed.line.traceId).to.equal(ingress.line.traceId);
  });

  it("continues a trace sent as a repeated traceparent header", async function () {
    const { connection } = stubbedConnection();
    globals.connections.push(connection);

    const task = await subscribingTask("receives a repeated header", "some/topic");
    forgetRegistrationLines();

    // a broker hands over an array when the publisher set the property twice
    const traceId = newTraceId();
    connection.handleMessage("some/topic", Buffer.from("1"), {
      properties: { userProperties: { traceparent: [toTraceparent(traceId)] } },
    } as any);
    await taskDone(task);

    const [ingress] = linesMatching("Received new message on topic");
    expect(ingress.line.traceId).to.equal(traceId);
  });

  it("shares one trace between every trigger an mqtt message matches", async function () {
    const { connection } = stubbedConnection();
    globals.connections.push(connection);

    const first = await subscribingTask("the first subscriber", "shared/topic");
    const second = await subscribingTask("the second subscriber", "shared/topic");
    forgetRegistrationLines();

    connection.handleMessage("shared/topic", Buffer.from("1"), {} as any);
    await Promise.all([taskDone(first), taskDone(second)]);

    const [ingress] = linesMatching("Received new message on topic");
    const [found] = linesMatching("Found 2 matching triggers.");
    const stashed = linesMatching("Stashing value under key");

    expect(ingress.line.traceId).to.be.a("string");
    expect(found.line.traceId).to.equal(ingress.line.traceId);
    expect(stashed).to.have.lengthOf(2);
    for (const { line } of stashed)
      expect(line.traceId).to.equal(ingress.line.traceId);
  });

  it("shares one trace between trigger:once and the steps it runs", async function () {
    const task = new Task(
      {
        trigger: { type: "trigger:once", message: "tick" } as any,
        steps: [{ type: "output:stash", key: "ran", value: "yes" } as any],
      },
      "runs a step once",
    );
    await task.register();
    // the trigger fires on a timeout, so its lines land after this clear
    forgetRegistrationLines();
    await taskDone(task);

    const [ran] = linesMatching("Running step once");
    const [stashed] = linesMatching("Stashing value under key");

    expect(ran.line.traceId).to.match(UUID_V7);
    expect(stashed.line.traceId).to.equal(ran.line.traceId);
  });

  it("keeps one trace across the event bus", async function () {
    const receiver = new Task(
      {
        trigger: { type: "trigger:event", key: "traced-happening" } as any,
        steps: [{ type: "output:stash", key: "received", value: "yes" } as any],
      },
      "receives an event",
    );
    const emitter = new Task(
      {
        steps: [{ type: "output:event", key: "traced-happening" } as any],
      },
      "emits an event",
    );

    await receiver.register();
    await emitter.register();
    forgetRegistrationLines();

    try {
      await emitter.startMessage("a happening", "a-shared-trace");
      await taskDone(receiver);

      const [emitted] = linesMatching("Emitting event with key");
      const [received] = linesMatching("Received event with key");
      const [stashed] = linesMatching("Stashing value under key");

      expect(emitted.line.traceId).to.equal("a-shared-trace");
      expect(received.line.traceId).to.equal("a-shared-trace");
      expect(stashed.line.traceId).to.equal("a-shared-trace");
    } finally {
      await receiver.trigger!.disable();
    }
  });

  it("starts a trace for an event emitted without one", async function () {
    const receiver = new Task(
      {
        trigger: { type: "trigger:event", key: "external-happening" } as any,
        steps: [{ type: "output:stash", key: "received", value: "yes" } as any],
      },
      "receives an external event",
    );

    await receiver.register();
    forgetRegistrationLines();

    try {
      // anything but output:event emits with one argument
      globals.eventBus.emit("external-happening", "a happening");
      await taskDone(receiver);

      const [received] = linesMatching("Received event with key");
      const [stashed] = linesMatching("Stashing value under key");

      expect(received.line.traceId).to.match(UUID_V7);
      expect(stashed.line.traceId).to.equal(received.line.traceId);
    } finally {
      await receiver.trigger!.disable();
    }
  });

  it("shares one trace between a sensor's reading and the task it starts", async function (context) {
    // the sampling and reporting intervals would otherwise outlive the test
    context.mock.timers.enable({ apis: ["setInterval"] });

    const task = new Task(
      {
        trigger: {
          type: "trigger:random",
          start: 20,
          min: 0,
          max: 40,
          minStep: 0.1,
          maxStep: 1,
        } as any,
        steps: [
          { type: "output:stash", key: "reading", value: "${message}" } as any,
        ],
      },
      "publishes a random reading",
    );

    try {
      // enable() publishes its first reading straight away, part-way through
      // register(), so the registration lines cannot be cleared first
      await task.register();
      await new Promise((resolve) => setImmediate(resolve));

      const [publishing] = linesMatching("Publishing new random data.");
      const [stashed] = linesMatching("Stashing value under key");

      expect(publishing.line.traceId).to.match(UUID_V7);
      expect(stashed.line.traceId).to.equal(publishing.line.traceId);
      // Sensor logs this one line under the module's type rather than under
      // its logPrefix, unlike every other line in the tree. Pinned rather than
      // fixed: deployed trigger:logs filters may match on the current topic.
      expect(publishing.line.topic).to.equal("trigger:random");
    } finally {
      await task.trigger!.disable();
    }
  });

  it("puts the trace on a virtual nec transmission", async function () {
    const task = new Task(
      { steps: [{ type: "output:nec", virtual: true } as any] },
      "transmits an nec command",
    );
    await task.register();
    forgetRegistrationLines();

    await task.startMessage({ address: "0x7c", command: "0x66" }, "an-nec-trace");

    const [transmitting] = linesMatching("Transmitting NEC command");
    expect(transmitting.line.traceId).to.equal("an-nec-trace");
  });

  it("puts the trace on the thermal printer's cannot-print error", async function () {
    // Disabled, so registering it opens no serial port; a step handles
    // messages either way.
    const task = new Task(
      {
        disabled: true,
        steps: [{ type: "output:thermal-printer" } as any],
      },
      "prints without a printer",
    );
    await task.register();
    forgetRegistrationLines();

    await task.startMessage("a receipt", "a-printer-trace");

    const [cannotPrint] = linesMatching("Cannot print");
    expect(cannotPrint.line.traceId).to.equal("a-printer-trace");
    expect(cannotPrint.line.verbosity).to.equal("error");
  });

  it("keeps two tasks' messages on traces of their own", async function () {
    const first = await tracedTask("the first task");
    const second = await tracedTask("the second task");
    forgetRegistrationLines();

    await first.startMessage("start", "the-first-trace");
    await second.startMessage("start");

    const secondsLines = captured.filter(({ line }) =>
      line.topic.startsWith(second.logPrefix),
    );

    expect(secondsLines.length).to.be.greaterThan(0);
    for (const { line } of secondsLines)
      expect(line.traceId, line.log).to.not.equal("the-first-trace");
    expect(new Set(secondsLines.map(({ line }) => line.traceId)).size).to.equal(
      1,
    );
  });

  describe("where a trigger logs", function () {
    // A trigger is not in the steps array, so findIndex returns -1 for it and
    // every trigger used to log under ".steps.-1".
    async function triggeredTask(name: string, key: string) {
      const task = new Task(
        {
          trigger: { type: "trigger:event", key } as any,
          steps: [
            { type: "output:stash", key: "first", value: "a" } as any,
            { type: "output:stash", key: "second", value: "b" } as any,
          ],
        },
        name,
      );
      await task.register();

      return task;
    }

    it("puts a trigger beside its task's steps, not among them", async function () {
      const task = await triggeredTask("names its trigger", "a-happening");

      try {
        expect(task.trigger!.logPrefix).to.equal(`${task.logPrefix}.trigger`);
        expect(task.steps.map((step) => step.logPrefix)).to.deep.equal([
          `${task.logPrefix}.steps.0`,
          `${task.logPrefix}.steps.1`,
        ]);
      } finally {
        await task.trigger!.disable();
      }
    });

    it("logs a trigger's own lines under that topic", async function () {
      // trigger:logs filters match on the topic, so the prefix has to be right
      // where the log bus hands it over, not just on the instance
      const task = await triggeredTask("reports its trigger", "another-happening");
      forgetRegistrationLines();

      try {
        globals.eventBus.emit("another-happening", "a happening");
        await taskDone(task);

        const [received] = linesMatching("Received event with key");
        expect(received.line.topic).to.equal(`${task.logPrefix}.trigger`);
      } finally {
        await task.trigger!.disable();
      }
    });
  });

  describe("trace durations", function () {
    it("still times a step that halts the message", async function () {
      const task = new Task(
        {
          steps: [
            { type: "transform:accumulate", count: 2 } as any,
            { type: "output:stash", key: "batch", value: "${message}" } as any,
          ],
        },
        "halts the first message",
      );
      await task.register();
      forgetRegistrationLines();

      await task.startMessage("first", "a-halted-trace");

      // the halting step still reports, and so does the task
      expect(timedTopics()).to.deep.equal([
        task.logPrefix,
        `${task.logPrefix}.steps.0`,
      ]);
      for (const { line } of linesMatching(HANDLED))
        expect(line.traceId).to.equal("a-halted-trace");
      expect(task.messagesHandled).to.equal(0);
    });

    it("times a task that has no steps at all", async function () {
      const task = new Task({ steps: [] }, "has no steps");
      await task.register();
      forgetRegistrationLines();

      await task.startMessage("start", "an-empty-trace");

      const timed = linesMatching(HANDLED);
      expect(timed).to.have.lengthOf(1);
      expect(timed[0].line.topic).to.equal(task.logPrefix);
      expect(timed[0].line.object).to.deep.equal({ steps: 0 });
      expect(timed[0].line.traceId).to.equal("an-empty-trace");
    });

    it("times nothing when a step throws", async function () {
      const task = new Task(
        {
          steps: [
            {
              type: "transform:javascript",
              command: 'throw new Error("boom")',
            } as any,
          ],
        },
        "throws mid-step",
      );
      await task.register();
      forgetRegistrationLines();

      // deliberate: no try/finally around the step chain, so a throw is
      // neither timed nor counted
      await expect(
        task.startMessage("start", "a-thrown-trace"),
      ).to.be.rejectedWith(/boom/);

      expect(linesMatching(HANDLED)).to.have.lengthOf(0);
      expect(task.messagesHandled).to.equal(0);
    });
  });

  describe("the log bus", function () {
    it("dispatches one line to every listener", function () {
      const a = extraListener("core.runtime.tasks.listener a");
      const b = extraListener("core.runtime.tasks.listener b");
      logger.logListeners = [a.listener, b.listener];

      new Configurable({}, "a source").info("a line", { topic: "core.custom" });

      expect(a.seen).to.have.lengthOf(1);
      expect(b.seen).to.have.lengthOf(1);
    });

    it("skips only the listener whose filters reject the line", function () {
      const a = extraListener("core.runtime.tasks.listener a", () => false);
      const b = extraListener("core.runtime.tasks.listener b");
      logger.logListeners = [a.listener, b.listener];

      new Configurable({}, "a source").info("a line", { topic: "core.custom" });

      expect(a.seen).to.have.lengthOf(0);
      expect(b.seen).to.have.lengthOf(1);
    });

    it("suppresses one listener's own line for every listener", function () {
      const a = extraListener("core.runtime.tasks.listener a");
      const b = extraListener("core.runtime.tasks.listener b");
      logger.logListeners = [a.listener, b.listener];

      new Configurable({}, "a source").info("a line", {
        topic: "core.runtime.tasks.listener a.steps.0",
      });

      expect(a.seen).to.have.lengthOf(0);
      expect(b.seen).to.have.lengthOf(0);
    });

    it("leaves a traceless line traceless", function () {
      new Configurable({}, "a source").info("a line", { topic: "core.custom" });

      expect(captured[0].line.traceId).to.equal(undefined);
      expect(captured[0].traceId).to.equal(undefined);
      expect(captured[0].line.log).to.equal("[core.custom] a line");
    });

    it("carries a trace through a real trigger:logs into output:logs", async function () {
      const task = new Task(
        {
          trigger: { type: "trigger:logs", filters: ["*"] } as any,
          steps: [{ type: "output:logs" } as any],
        },
        "a real logs task",
      );
      await task.register();

      try {
        new Configurable({}, "a source").info("a traced line", {
          topic: "core.custom",
          traceId: "a-logged-trace",
        });
        await taskDone(task);

        const [relogged] = printed.filter(({ log }) =>
          log.includes("a traced line"),
        );
        expect(relogged.verbosity).to.equal("info");
        expect(relogged.log).to.include("(a-logged-trace)");
      } finally {
        await task.trigger!.disable();
      }
    });

    it("puts the trace on the payload a logs task receives", async function () {
      const task = new Task(
        {
          trigger: { type: "trigger:logs", filters: ["*"] } as any,
          steps: [
            {
              type: "output:stash",
              key: "trace",
              value: "${message.traceId}",
            } as any,
          ],
        },
        "a stashing logs task",
      );
      await task.register();

      try {
        new Configurable({}, "a source").info("a traced line", {
          topic: "core.custom",
          traceId: "a-stashed-trace",
        });
        await taskDone(task);

        expect(task.stash!.trace).to.equal("a-stashed-trace");
      } finally {
        await task.trigger!.disable();
      }
    });
  });

  describe("output:mqtt trace propagation", function () {
    // A publisher with no connection behind it, for the paths that never
    // reach a broker.
    function unconnectedPublisher() {
      const task = new Task({ steps: [] }, "publishes with no connection");

      return new MQTTOutput(
        {
          type: "output:mqtt",
          connectionName: "broker",
          topics: ["trace/nowhere"],
          propagateTrace: true,
        } as any,
        task,
      );
    }

    it("continues a trace across mqtt when the connection speaks v5", async function () {
      const { traceId } = await roundTrip(true, 5);

      const [ingress] = linesMatching("Received new message on topic");
      expect(ingress.line.traceId).to.equal(traceId);
      expect(warnings).to.have.lengthOf(0);
    });

    it("publishes a traceparent that decodes back to the publisher's trace", async function () {
      const { traceId, packets } = await roundTrip(true, 5);

      expect(packets).to.have.lengthOf(1);
      const header = packets[0].properties.userProperties.traceparent;
      expect(header).to.match(TRACEPARENT);
      expect(fromTraceparent(header)).to.equal(traceId);
    });

    it("puts one traceparent on every topic a publish targets", async function () {
      const { connection, packets } = await brokeredConnection(5);
      await connection.connection.subscribeAsync("trace/#");

      const publisher = new Task(
        {
          steps: [
            {
              type: "output:mqtt",
              connectionName: "broker",
              topics: ["trace/one", "trace/two"],
              propagateTrace: true,
            } as any,
          ],
        },
        "publishes to two topics",
      );
      await publisher.register();
      globals.tasks.push(publisher);

      const traceId = newTraceId();
      await publisher.startMessage("tick", traceId);

      const headers = packets.map(
        (packet) => packet.properties.userProperties.traceparent,
      );
      expect(headers).to.have.lengthOf(2);
      expect(headers[0]).to.equal(headers[1]);
      expect(fromTraceparent(headers[0])).to.equal(traceId);
    });

    it("still delivers the message on a v4 connection, under its own trace", async function () {
      const { traceId, subscriber, packets } = await roundTrip(true);

      const [ingress] = linesMatching("Received new message on topic");
      expect(ingress.line.traceId).to.match(UUID_V7);
      expect(ingress.line.traceId).to.not.equal(traceId);
      expect(subscriber.messagesHandled).to.equal(1);
      expect(packets[0].properties).to.equal(undefined);
      // one warning naming the setting that would have made it work
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include("protocolVersion");
    });

    it("warns once per output rather than once per message", async function () {
      const { publisher } = await roundTrip(true);

      await publisher.startMessage("tick", newTraceId());
      await publisher.startMessage("tick", newTraceId());

      expect(warnings).to.have.lengthOf(1);
    });

    it("leaves the trace off an mqtt publish that did not ask for it", async function () {
      const { traceId, packets } = await roundTrip(false, 5);

      const [ingress] = linesMatching("Received new message on topic");
      expect(ingress.line.traceId).to.match(UUID_V7);
      expect(ingress.line.traceId).to.not.equal(traceId);
      expect(packets[0].properties).to.equal(undefined);
      expect(warnings).to.have.lengthOf(0);
    });

    it("does not throw when the connection has already been closed", function () {
      const output = unconnectedPublisher();
      // what MQTTConnection.disable() leaves behind
      output.mqtt = { connection: undefined } as any;

      expect(output.publishOptions("a-trace")).to.equal(undefined);
    });

    it("warns when the output has no connection at all", function () {
      const output = unconnectedPublisher();
      output.mqtt = undefined;

      expect(output.publishOptions("a-trace")).to.equal(undefined);
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include("protocolVersion");
    });
  });
});
