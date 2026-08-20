import { EventEmitter } from "node:events";

import MqttTopics from "mqtt-topics";

import { Globals } from "../src/index.js";
import Task from "../src/util/Task.js";
import {
  PigpioClient,
  PigpioClientGpio,
} from "../src/util/pigpio-client.js";
import {
  NEC_HEADER_HIGH_US,
  NEC_HEADER_LOW_US,
  NEC_TRAILER_US,
} from "../src/util/bitbang/adapters/nec.js";
import { NEC_LONG_GAP_US, NEC_PULSE_US } from "../src/util/bitbang/helpers.js";

export const mockTask = {
  config: { steps: [] },
} as unknown as Task;

export const mockGlobals = {
  name: "island",
  deeply: { nested: "metadata" },
} as unknown as Globals;

// An in-memory stand-in for an MQTT broker: enough of the mqtt client surface
// for the connection, trigger, and output modules, with real wildcard matching
// and retained messages. Pass the returned `mqtt` to mock.module("mqtt").
export function createMqttMock(retained: Record<string, string> = {}) {
  const retainedMessages = new Map(Object.entries(retained));

  const clients: Array<any> = [];

  class FakeMqttClient extends EventEmitter {
    options: { clientId: string; protocolVersion?: number };
    subscriptions = new Set<string>();
    ended = false;

    constructor(index: number, options: any = {}) {
      super();
      this.options = { clientId: `mock_client_${index}`, ...options };
    }

    deliver(topic: string, payload: string, properties?: any) {
      for (const filter of this.subscriptions) {
        if (MqttTopics.match(filter, topic)) {
          this.emit("message", topic, Buffer.from(payload), {
            topic,
            properties,
          });
          return;
        }
      }
    }

    subscribe(topics: any) {
      return this.subscribeAsync(topics);
    }

    async subscribeAsync(topics: any) {
      const list = Array.isArray(topics) ? topics : [topics];
      for (const filter of list) {
        this.subscriptions.add(filter);
        for (const [topic, payload] of retainedMessages) {
          // a real broker delivers retained messages after the subscribe
          // round-trip, not inline with it
          if (MqttTopics.match(filter, topic))
            setTimeout(() => this.deliver(topic, payload), 0);
        }
      }
    }

    async unsubscribeAsync(topics: any) {
      const list = Array.isArray(topics) ? topics : [topics];
      list.forEach((filter: string) => this.subscriptions.delete(filter));
    }

    publish(topic: string, message: any, options?: any) {
      this.publishAsync(topic, message, options);
    }

    async publishAsync(topic: string, message: any, options?: any) {
      const payload = message.toString();
      if (options?.retain) retainedMessages.set(topic, payload);
      // v5 publish properties -- user properties among them -- reach the
      // subscriber on the packet, which is how a trace crosses the broker
      for (const client of clients)
        if (!client.ended) client.deliver(topic, payload, options?.properties);
    }

    async endAsync() {
      this.ended = true;
      this.subscriptions.clear();
    }
  }

  // The connection's options are read back by the modules -- output:mqtt gates
  // trace propagation on protocolVersion -- so they have to survive connecting.
  async function connectAsync(_endpoint?: string, options?: any) {
    const client = new FakeMqttClient(clients.length, options);
    clients.push(client);
    return client;
  }

  return {
    retainedMessages,
    clients,
    mqtt: {
      connectAsync,
      connect: (_endpoint?: string, options?: any) => {
        const client = new FakeMqttClient(clients.length, options);
        clients.push(client);
        return client;
      },
    },
  };
}

// The wave id createPigpioClientMock hands back, so an assertion can name the
// wave that was created and deleted.
export const MOCK_WAVE_ID = 7;

// The slice of pigpio-client the waveform code drives (src/util/pigpio-client.ts),
// recording every call in order so a transmission's ordering can be asserted.
// `gpio` is returned alongside so a test can override one of its methods
// (e.g. to make waveSendOnce throw).
export function createPigpioClientMock() {
  const calls: Array<string> = [];

  const gpio: PigpioClientGpio = {
    modeSet: (mode) => {
      calls.push(`modeSet(${mode})`);
    },
    write: (level) => {
      calls.push(`write(${level})`);
    },
    notify: () => {
      calls.push("notify");
    },
    endNotify: () => {
      calls.push("endNotify");
    },
    waveClear: async () => {
      calls.push("waveClear");
    },
    waveAddPulse: async () => {
      calls.push("waveAddPulse");
    },
    waveCreate: async () => {
      calls.push("waveCreate");
      return MOCK_WAVE_ID;
    },
    waveSendOnce: async (waveId: number) => {
      calls.push(`waveSendOnce(${waveId})`);
    },
    waveNotBusy: async () => {
      calls.push("waveNotBusy");
    },
    waveDelete: async (waveId: number) => {
      calls.push(`waveDelete(${waveId})`);
    },
  };

  const pigpioClient: PigpioClient = {
    gpio: (pin: number) => {
      calls.push(`gpio(${pin})`);
      return gpio;
    },
    once: () => {},
    on: () => {},
    removeListener: () => {},
  };

  return { calls, gpio, pigpioClient };
}

// Turns a 32-bit NEC payload into the {level, tick} edges a receiver would
// produce for it, active-low, so decode logic can be tested without pigpio
// or real hardware.
export function necReceiverEdges(
  bits: Array<boolean>,
  startTick = 1_000_000,
): Array<{ level: number; tick: number }> {
  const segments: Array<{ level: 0 | 1; duration: number }> = [
    { level: 0, duration: NEC_HEADER_HIGH_US },
    { level: 1, duration: NEC_HEADER_LOW_US },
  ];

  for (const bit of bits) {
    segments.push({ level: 0, duration: NEC_PULSE_US });
    segments.push({
      level: 1,
      duration: bit ? NEC_LONG_GAP_US : NEC_PULSE_US,
    });
  }

  segments.push({ level: 0, duration: NEC_TRAILER_US });

  let tick = startTick;
  const edges = [{ level: segments[0].level, tick }];
  for (const segment of segments) {
    tick += segment.duration;
    edges.push({ level: segment.level === 0 ? 1 : 0, tick });
  }

  return edges;
}

interface TaskDoneOptions {
  timeout: number;
  waitFor: number;
}

export function taskDone(
  task: Task,
  incomingOptions?: Partial<TaskDoneOptions>,
) {
  const options: TaskDoneOptions = {
    timeout: 10,
    waitFor: 1,
    ...incomingOptions,
  };

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `Task "${task.name}" handled ${task.messagesHandled} of ${options.waitFor} expected messages within ${options.timeout}ms.`,
          ),
        ),
      options.timeout,
    );
    const interval = setInterval(() => {
      if (task.messagesHandled >= options.waitFor) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      }
    }, 1);
  });
}
