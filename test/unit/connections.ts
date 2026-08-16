import { describe, it, before, mock } from "node:test";
import { EventEmitter } from "node:events";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;

import { registerConnections } from "../../src/util/connections.js";
import { setGlobals } from "../../src/index.js";

describe("registerConnections", function () {
  before(() => {
    mock.module("mqtt", {
      defaultExport: {
        connectAsync: async () => {
          throw Object.assign(
            new Error("connect ECONNREFUSED 127.0.0.1:1883"),
            {
              code: "ECONNREFUSED",
            },
          );
        },
      },
    });
  });

  it("logs a connection failure instead of crashing, and still resolves", async function () {
    const emitted: Array<{ message: string; verbosity: string }> = [];
    const errored: Array<{ message: string; object?: object }> = [];
    setGlobals({
      logger: {
        emit: (message: string, verbosity: string) =>
          emitted.push({ message, verbosity }),
        error: (message: string, object?: object) =>
          errored.push({ message, object }),
        logListeners: [],
      },
      connections: [],
      tasks: [],
      eventBus: new EventEmitter(),
    } as any);

    await expect(
      registerConnections([
        {
          type: "connection:mqtt",
          name: "broker",
          endpoint: "mqtt://127.0.0.1:1883",
        } as any,
      ]),
    ).to.not.be.rejected;

    expect(
      emitted.some(
        (line) => line.verbosity === "error" && line.message.includes("broker"),
      ),
    ).to.equal(true);

    // Connections register before tasks, so no trigger:logs listener can be
    // active yet -- emit() alone would be invisible on a real run. This
    // asserts the direct-pino fallback fires too.
    expect(errored.some((line) => line.message.includes("broker"))).to.equal(
      true,
    );
  });
});
