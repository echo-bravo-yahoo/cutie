import { afterEach, before, describe, it } from "node:test";
import { EventEmitter } from "node:events";
import net from "node:net";

import * as chai from "chai";
import mqttPacket from "mqtt-packet";
const { expect } = chai;

import { Globals, setGlobals } from "../../src/index.js";
import MQTTConnection from "../../src/connections/mqtt.js";

// These tests run the real mqtt client against a small in-process broker that
// is started late, which is how a node boots when its network comes up after
// cutie does.
const lines: Array<{ message: string; verbosity: string }> = [];

function useRecordingLogger() {
  lines.length = 0;
  setGlobals({
    tasks: [],
    connections: [],
    version: "test",
    logger: {
      emit: (message: string, verbosity: string) =>
        lines.push({ message, verbosity }),
      logListeners: [],
    },
    eventBus: new EventEmitter(),
    configDir: process.cwd(),
  } as unknown as Globals);
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));

  return port;
}

// Speaks just enough MQTT 3.1.1 to accept a client, acknowledge subscriptions,
// and record what it was sent.
async function startBroker(port: number) {
  const subscribed: Array<string> = [];
  const published: Array<{ topic: string; payload: string }> = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const parser = mqttPacket.parser();

    parser.on("packet", (packet) => {
      if (packet.cmd === "connect") {
        socket.write(
          mqttPacket.generate({
            cmd: "connack",
            returnCode: 0,
            sessionPresent: false,
          }),
        );
      } else if (packet.cmd === "subscribe") {
        subscribed.push(...packet.subscriptions.map((sub) => sub.topic));
        socket.write(
          mqttPacket.generate({
            cmd: "suback",
            messageId: packet.messageId,
            granted: packet.subscriptions.map(() => 0),
          }),
        );
      } else if (packet.cmd === "publish") {
        published.push({
          topic: packet.topic,
          payload: packet.payload.toString(),
        });
      } else if (packet.cmd === "pingreq") {
        socket.write(mqttPacket.generate({ cmd: "pingresp" }));
      }
    });

    socket.on("data", (data) => parser.parse(data));
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );

  return {
    subscribed,
    published,
    async stop() {
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function eventually(check: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition never became true");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("an MQTT connection to a broker that is not up yet", function () {
  const cleanups: Array<() => Promise<void>> = [];

  before(function () {
    useRecordingLogger();
  });

  afterEach(async function () {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function connectionTo(port: number) {
    const connection = new MQTTConnection({
      type: "connection:mqtt",
      name: "broker",
      endpoint: `mqtt://127.0.0.1:${port}`,
      reconnectPeriod: 50,
    } as never);
    cleanups.push(() => connection.disable());

    return connection;
  }

  it("registers without waiting forever, then connects when the broker appears", async function () {
    useRecordingLogger();
    const port = await freePort();
    const connection = await connectionTo(port);

    await connection.register(100);

    expect(connection.connection.connected).to.equal(false);
    expect(
      lines.filter((line) => line.verbosity === "warn").length,
      "a warning that the broker is unreachable",
    ).to.be.greaterThan(0);

    const broker = await startBroker(port);
    cleanups.push(() => broker.stop());

    await eventually(() => connection.connection.connected);
    expect(lines.some((line) => line.message.includes("Connected"))).to.equal(
      true,
    );
  });

  it("subscribes the topics asked for while it was down once it connects", async function () {
    useRecordingLogger();
    const port = await freePort();
    const connection = await connectionTo(port);

    await connection.register(100);
    await connection.enable();

    // Must come back at once: an offline subscribeAsync would not.
    await connection.subscribe(["sensors/#", "alarms/+"]);

    const broker = await startBroker(port);
    cleanups.push(() => broker.stop());

    await eventually(() => broker.subscribed.length === 2);
    expect(broker.subscribed).to.have.members(["sensors/#", "alarms/+"]);
  });

  it("forgets a topic that was unsubscribed before it ever connected", async function () {
    useRecordingLogger();
    const port = await freePort();
    const connection = await connectionTo(port);

    await connection.register(100);
    await connection.enable();
    await connection.subscribe(["kept/topic", "dropped/topic"]);
    await connection.unsubscribe("dropped/topic");

    const broker = await startBroker(port);
    cleanups.push(() => broker.stop());

    await eventually(() => broker.subscribed.length > 0);
    expect(broker.subscribed).to.deep.equal(["kept/topic"]);
  });

  it("publishes once the broker is there", async function () {
    useRecordingLogger();
    const port = await freePort();
    const connection = await connectionTo(port);

    await connection.register(100);

    const broker = await startBroker(port);
    cleanups.push(() => broker.stop());
    await eventually(() => connection.connection.connected);

    await connection.sendRaw("data/weather", "72.5");

    await eventually(() => broker.published.length === 1);
    expect(broker.published[0]).to.deep.equal({
      topic: "data/weather",
      payload: "72.5",
    });
  });

  it("can be disabled while it is still offline", async function () {
    useRecordingLogger();
    const port = await freePort();
    const connection = await connectionTo(port);

    await connection.register(100);

    await Promise.race([
      connection.disable(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("disable() hung")), 2000),
      ),
    ]);

    expect(connection.connection).to.equal(undefined);
  });
});
