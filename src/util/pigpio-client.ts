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
  waveNotBusy(): Promise<void>;
  waveDelete(waveId: number): Promise<unknown>;
}

export interface PigpioClient {
  gpio(pin: number): PigpioClientGpio;
  once(event: "connected" | "error", listener: (arg?: unknown) => void): void;
  on(
    event: "disconnected" | "error",
    listener: (arg?: unknown) => void,
  ): void;
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

export function getPigpioConnection(
  requiredBy: string,
): Promise<PigpioClient> {
  if (!connection) connection = connect(requiredBy);
  return connection;
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
      // from this connection goes silently inert until cutie restarts.
      // Known, accepted limitation for v1 -- don't build auto-resubscribe
      // machinery here without a concrete reason to.
      //
      // Under the core topic because this connection is shared across every
      // GPIO trigger/output and is not itself a Configurable.
      client.on("disconnected", (reason) => {
        logAt(
          CORE_TOPIC,
          "error",
          `Lost connection to pigpiod at ${PIGPIOD_HOST}:${PIGPIOD_PORT} (${String(reason)}). GPIO triggers/outputs using this connection are now inert until cutie restarts.`,
        );
        connection = undefined;
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
      connection = undefined; // let the next caller retry instead of caching this failure
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
