import { EventEmitter } from "node:events";

import MqttTopics from "mqtt-topics";

import { Globals } from "../src/index.js";
import Task from "../src/util/Task.js";

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
