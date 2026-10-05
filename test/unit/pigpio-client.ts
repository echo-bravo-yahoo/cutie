import { before, describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
const { expect } = chai;

import { Globals, setGlobals } from "../../src/index.js";

const fakeLogger = {
  emit: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logListeners: [] as Array<unknown>,
  addListener(listener: unknown) {
    this.logListeners.push(listener);
  },
  removeListener(listener: unknown) {
    const index = this.logListeners.indexOf(listener);
    if (index !== -1) this.logListeners.splice(index, 1);
  },
  logger: {
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => fakeLogger,
  },
};

// connect()'s own surface needs only once("connected"/"error"),
// on("disconnected"/"error"), and removeListener -- a plain EventEmitter
// covers all of it, so firing these events drives the real reconnect logic
// exactly as a live pigpio-client socket would.
function fakeClient() {
  const client = new EventEmitter() as EventEmitter & {
    gpio: () => unknown;
  };
  client.gpio = () => ({});
  return client;
}

// Set once per test, read by the mocked importOptional below -- this is the
// one seam connect() has for reaching a "pigpio-client" factory, and
// indirecting through a variable means the whole file needs only one
// mock.module() registration rather than one per test.
let currentFactory: () => EventEmitter;

before(function () {
  setGlobals({
    tasks: [],
    connections: [],
    version: "test",
    logger: fakeLogger,
    eventBus: new EventEmitter(),
    configDir: process.cwd(),
  } as unknown as Globals);

  mock.module("../../src/util/optional-dependency.js", {
    namedExports: {
      importOptional: async () => ({ pigpio: () => currentFactory() }),
    },
  });
});

// pigpio-client.ts holds its connection and subscriber registry in
// module-level state, so re-importing the real specifier would leak state
// between tests. A cache-busting query string gives each test its own fresh
// module instance while still resolving "./optional-dependency.js" to the
// one mock registered above.
let cacheBuster = 0;
async function freshPigpioClient() {
  cacheBuster++;
  return import(`../../src/util/pigpio-client.js?pigpio-client-test=${cacheBuster}`);
}

describe("pigpio-client reconnect", function () {
  it("re-enables every registered subscriber, disable before enable, after pigpiod drops and reconnects", async function (context) {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const clients: Array<EventEmitter> = [];
    currentFactory = () => {
      const client = fakeClient();
      clients.push(client);
      return client;
    };

    const { getPigpioConnection, onPigpioReconnect, RECONNECT_INTERVAL_MS } =
      await freshPigpioClient();

    const order: Array<string> = [];
    onPigpioReconnect({
      enable: async () => {
        order.push("enable");
      },
      disable: async () => {
        order.push("disable");
      },
    });

    const firstConnect = getPigpioConnection("initial");
    await new Promise((resolve) => setImmediate(resolve));
    clients[0].emit("connected");
    await firstConnect;

    clients[0].emit("disconnected", "pigpiod exited");
    context.mock.timers.tick(RECONNECT_INTERVAL_MS);
    await new Promise((resolve) => setImmediate(resolve));

    expect(clients).to.have.lengthOf(2);
    clients[1].emit("connected");

    const reconnected = await getPigpioConnection("after drop");
    expect(reconnected).to.equal(clients[1]);
    expect(order).to.deep.equal(["disable", "enable"]);
  });

  it("retries on an interval after a failed reconnect attempt, before eventually succeeding", async function (context) {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const clients: Array<EventEmitter> = [];
    currentFactory = () => {
      const client = fakeClient();
      clients.push(client);
      return client;
    };

    const { getPigpioConnection, RECONNECT_INTERVAL_MS } =
      await freshPigpioClient();

    const firstConnect = getPigpioConnection("initial");
    await new Promise((resolve) => setImmediate(resolve));
    clients[0].emit("connected");
    await firstConnect;

    clients[0].emit("disconnected", "pigpiod exited");
    await new Promise((resolve) => setImmediate(resolve));
    expect(clients).to.have.lengthOf(2);

    // The first retry fails -- the loop should wait a full interval before
    // trying a third time, not retry immediately.
    clients[1].emit("error", new Error("still down"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(clients).to.have.lengthOf(2);

    context.mock.timers.tick(RECONNECT_INTERVAL_MS);
    await new Promise((resolve) => setImmediate(resolve));
    expect(clients).to.have.lengthOf(3);

    clients[2].emit("connected");
    expect(await getPigpioConnection("after retry")).to.equal(clients[2]);
  });

  it("lets a concurrent caller await the same in-flight retry instead of racing a second connect", async function (context) {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const clients: Array<EventEmitter> = [];
    currentFactory = () => {
      const client = fakeClient();
      clients.push(client);
      return client;
    };

    const { getPigpioConnection } = await freshPigpioClient();

    const firstConnect = getPigpioConnection("initial");
    await new Promise((resolve) => setImmediate(resolve));
    clients[0].emit("connected");
    await firstConnect;

    clients[0].emit("disconnected", "pigpiod exited");
    await new Promise((resolve) => setImmediate(resolve));
    expect(clients).to.have.lengthOf(2);

    // A second, unrelated caller reaches for the connection while the retry
    // above is still in flight.
    const concurrentCaller = getPigpioConnection("concurrent caller");
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      clients,
      "a concurrent caller mid-retry should not trigger its own connect()",
    ).to.have.lengthOf(2);

    clients[1].emit("connected");

    const [reconnected, concurrent] = await Promise.all([
      getPigpioConnection("after drop"),
      concurrentCaller,
    ]);
    expect(reconnected).to.equal(clients[1]);
    expect(concurrent).to.equal(clients[1]);
    expect(clients).to.have.lengthOf(2);
  });

  it("never re-enables a subscriber that unsubscribed before the drop", async function (context) {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const clients: Array<EventEmitter> = [];
    currentFactory = () => {
      const client = fakeClient();
      clients.push(client);
      return client;
    };

    const { getPigpioConnection, onPigpioReconnect } =
      await freshPigpioClient();

    const order: Array<string> = [];
    const unsubscribe = onPigpioReconnect({
      enable: async () => {
        order.push("enable");
      },
      disable: async () => {
        order.push("disable");
      },
    });

    const firstConnect = getPigpioConnection("initial");
    await new Promise((resolve) => setImmediate(resolve));
    clients[0].emit("connected");
    await firstConnect;

    // Simulates an ordinary task teardown: the module calls its own
    // disable(), whose first line unsubscribes, before the drop ever happens.
    unsubscribe();

    clients[0].emit("disconnected", "pigpiod exited");
    await new Promise((resolve) => setImmediate(resolve));
    expect(clients).to.have.lengthOf(2);
    clients[1].emit("connected");
    await getPigpioConnection("after drop");

    expect(order).to.deep.equal([]);
  });
});
