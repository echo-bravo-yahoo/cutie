import { importOptional } from "./optional-dependency.js";
import { CORE_TOPIC, logAt } from "./LogHelper.js";

// pigpio-client ships no types and is an optional dependency; this mirrors
// only the shape actually used by trigger:infrared, trigger:nec,
// trigger:gpio-button, and output:nec.
export interface PigpioClientGpio {
  modeSet(mode: "input" | "output"): void;
  write(level: 0 | 1): void;
  notify(callback: (level: number | null, tick: number | null) => void): void;
  endNotify(): void;
  waveClear(): Promise<unknown>;
  waveCreate(): Promise<number>;
  waveAddPulse(triplets: Array<[number, number, number]>): Promise<unknown>;
  waveSendOnce(waveId: number): Promise<unknown>;
  waveNotBusy(intervalMs?: number): Promise<void>;
  waveDelete(waveId: number): Promise<unknown>;
}

export interface PigpioClient {
  gpio(pin: number): PigpioClientGpio;
  once(event: "connected" | "error", listener: (arg?: unknown) => void): void;
  on(event: "disconnected" | "error", listener: (arg?: unknown) => void): void;
  removeListener(event: string, listener: (arg?: unknown) => void): void;
}

interface PigpioClientModule {
  pigpio(options?: {
    host?: string;
    port?: number;
    timeout?: number;
  }): PigpioClient;
}

const PIGPIOD_HOST = "localhost";
const PIGPIOD_PORT = 8888;

// Every trigger/output that needs pigpiod shares this one socket connection
// rather than each opening its own.
let connection: Promise<PigpioClient> | undefined;

export function getPigpioConnection(requiredBy: string): Promise<PigpioClient> {
  if (!connection)
    connection = connect(requiredBy).catch((error) => {
      connection = undefined; // let the next caller retry instead of caching this failure
      throw error;
    });
  return connection;
}

type ReconnectSubscriber = {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};
const reconnectSubscribers = new Set<ReconnectSubscriber>();

// Every GPIO trigger/output registers itself here from its own enable(), and
// unregisters from disable() -- so a dropped pigpiod connection can bring
// each one back by re-running exactly the same two lifecycle methods an
// ordinary config reload already calls on every task (teardown(), then
// registerTasks() -- src/util/lifecycle.ts, src/index.ts), without this
// module needing to know what a "trigger" or a "task" is.
export function onPigpioReconnect(subscriber: ReconnectSubscriber): () => void {
  reconnectSubscribers.add(subscriber);
  return () => reconnectSubscribers.delete(subscriber);
}

export const RECONNECT_INTERVAL_MS = 2000;

// Kept as the one promise `connection` points at for the whole retry window,
// so a getPigpioConnection() call mid-retry awaits this instead of racing a
// second connect() -- the same reasoning as getPigpioConnection's own
// catch above, just held open across every attempt rather than one.
function reconnectAfterDrop(requiredBy: string): void {
  connection = (async () => {
    for (;;) {
      try {
        const client = await connect(requiredBy);

        logAt(
          CORE_TOPIC,
          "info",
          `Reconnected to pigpiod at ${PIGPIOD_HOST}:${PIGPIOD_PORT}; re-enabling ${reconnectSubscribers.size} GPIO module(s).`,
        );

        await Promise.allSettled(
          [...reconnectSubscribers].map((subscriber) =>
            subscriber.disable().then(() => subscriber.enable()),
          ),
        );

        return client;
      } catch {
        await new Promise((resolve) =>
          setTimeout(resolve, RECONNECT_INTERVAL_MS),
        );
      }
    }
  })();
}

async function connect(requiredBy: string): Promise<PigpioClient> {
  const { pigpio } = await importOptional<PigpioClientModule>(
    "pigpio-client",
    requiredBy,
  );

  const client = pigpio({ host: PIGPIOD_HOST, port: PIGPIOD_PORT });

  return new Promise((resolve, reject) => {
    const onConnected = () => {
      client.removeListener("error", onConnectError);

      // pigpio-client does not reconnect on its own after a disconnect (its
      // retry logic only applies to the *initial* connect attempt). If
      // pigpiod dies later, every GPIO trigger/output holding a gpio object
      // from this connection would go silently inert without the retry loop
      // below -- reconnectAfterDrop re-runs each registered module's own
      // enable()/disable() once a fresh connection is back.
      //
      // Under the core topic because this connection is shared across every
      // GPIO trigger/output and is not itself a Configurable.
      client.on("disconnected", (reason) => {
        logAt(
          CORE_TOPIC,
          "error",
          `Lost connection to pigpiod at ${PIGPIOD_HOST}:${PIGPIOD_PORT} (${String(reason)}). Reconnecting.`,
        );
        connection = undefined;
        reconnectAfterDrop(requiredBy);
      });
      client.on("error", (error) => {
        logAt(
          CORE_TOPIC,
          "error",
          `pigpio-client reported an error: ${String(error)}`,
        );
      });

      resolve(client);
    };

    const onConnectError = (error: unknown) => {
      client.removeListener("connected", onConnected);
      const message = error instanceof Error ? error.message : String(error);
      reject(
        new Error(
          `${requiredBy} could not connect to pigpiod at ${PIGPIOD_HOST}:${PIGPIOD_PORT}: ${message}. Is pigpiod running? Check with "systemctl status pigpiod" and start it with "sudo systemctl enable --now pigpiod".`,
        ),
      );
    };

    client.once("connected", onConnected);
    client.once("error", onConnectError);
  });
}

// pigpiod's wave state (waveClear/waveCreate/waveBusy) is global to the
// daemon, not scoped per connection or per GPIO pin -- pigpio-client's own
// README: "waveClear, waveCreate and waveBusy are not gpio specific ... only
// a single waveform can be active." Step.handleMessage (src/util/Step.ts:63)
// never serializes concurrent messages to the same step, so two overlapping
// output:nec sends -- even from the same process, even the same connection
// -- could otherwise interleave and corrupt each other's wave. Every
// wave-touching caller in this process funnels through this one queue so at
// most one is ever mid-transmission at a time.
let waveQueue: Promise<unknown> = Promise.resolve();

export function withWaveLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = waveQueue.then(fn);
  waveQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
