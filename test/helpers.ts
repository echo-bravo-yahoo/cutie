import { EventEmitter } from "node:events";

import MqttTopics from "mqtt-topics";

import { Globals } from "../src";
import Task from "../src/util/Task";

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
    options: { clientId: string };
    subscriptions = new Set<string>();
    ended = false;

    constructor(index: number) {
      super();
      this.options = { clientId: `mock_client_${index}` };
    }

    deliver(topic: string, payload: string) {
      for (const filter of this.subscriptions) {
        if (MqttTopics.match(filter, topic)) {
          this.emit("message", topic, Buffer.from(payload), { topic });
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
      for (const client of clients)
        if (!client.ended) client.deliver(topic, payload);
    }

    async endAsync() {
      this.ended = true;
      this.subscriptions.clear();
    }
  }

  async function connectAsync() {
    const client = new FakeMqttClient(clients.length);
    clients.push(client);
    return client;
  }

  return {
    retainedMessages,
    clients,
    mqtt: {
      connectAsync,
      connect: () => {
        const client = new FakeMqttClient(clients.length);
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
