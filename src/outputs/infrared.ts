import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import {
  DEFAULT_CARRIER_FREQUENCY_HZ,
  rawPulsesToWave,
  transmitWave,
} from "../util/bitbang/helpers.js";
import { getPigpioConnection, PigpioClient } from "../util/pigpio-client.js";
import { ModuleSchema } from "../util/schema.js";

// The wire format for a raw code: relative microsecond durations,
// alternating LED-on/LED-off, always starting on. Pure durations rather than
// absolute tick values, because pigpio's tick is a free-running counter that
// wraps roughly every 72 minutes and is meaningless outside the one capture
// session that produced it -- transform:ir-pulses already converts a
// capture into this shape, so it replays here with no further processing.
export interface RawIRCode {
  pulses: Array<number>;
}

export interface InfraredOutputConfig extends OutputConfig {
  ledPin: number;
  virtual?: boolean;
  savedCodes?: Record<string, RawIRCode>;
  carrierFrequencyHz?: number;
}

export default class InfraredOutput extends Output {
  declare config: InfraredOutputConfig;
  pigpioClient?: PigpioClient;

  constructor(config: InfraredOutputConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // A pin is required only when one is actually driven, which is a pairing
  // no single option's schema can express.
  async register() {
    if (!this.config.virtual && this.config.ledPin === undefined)
      throw new Error(
        `"output:infrared" needs a "ledPin" naming the GPIO pin the infrared LED is on, or "virtual": true.`,
      );
  }

  resolveCode(message: Message): RawIRCode {
    const body = message as unknown as
      | (RawIRCode & { id?: string })
      | undefined;

    if (body?.id) {
      const saved = this.config.savedCodes?.[body.id];
      if (!saved)
        throw new Error(
          `No saved infrared code named "${body.id}"; known codes are ${JSON.stringify(Object.keys(this.config.savedCodes || {}))}.`,
        );
      return saved;
    }

    const pulses = body?.pulses;
    if (
      !Array.isArray(pulses) ||
      pulses.length === 0 ||
      !pulses.every((p) => Number.isFinite(p) && p > 0)
    )
      throw new Error(
        `An infrared code needs a non-empty "pulses" array of positive microsecond durations; got ${JSON.stringify(body)}.`,
      );

    return { pulses };
  }

  async send(message: Message, traceId: string) {
    const code = this.resolveCode(message);

    this.info(
      `Transmitting a raw infrared code (${code.pulses.length} pulses).`,
      { traceId },
      { code },
    );

    if (this.config.virtual || !this.pigpioClient) return message;

    await transmitWave(
      this.pigpioClient,
      rawPulsesToWave(
        code.pulses,
        this.config.ledPin,
        this.config.carrierFrequencyHz,
      ),
      this.config.ledPin,
    );

    return message;
  }

  async enable() {
    if (!this.config.virtual) {
      this.pigpioClient = await getPigpioConnection("output:infrared");
    }

    this.info("Enabled infrared.");
    this.enabled = true;
  }

  async disable() {
    this.pigpioClient = undefined;
    this.info("Disabled infrared.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "output:infrared",
  description:
    'Transmits a raw infrared pulse train on a GPIO pin. The message either names a saved code, {"id": "livingRoomPower"}, or spells one out as {"pulses": [9000, 4500, 563, 563, ...]} -- microsecond durations alternating LED-on/LED-off, starting on. This is the shape trigger:infrared + transform:debounce + transform:ir-pulses capture, so a learned code replays unchanged.',
  options: {
    ledPin: {
      type: "number",
      description:
        "The GPIO pin the infrared LED is wired to. Required unless virtual is set; there is no sensible default for someone else's wiring.",
      integer: true,
      min: 0,
    },
    virtual: {
      type: "boolean",
      description: "Log the code that would be sent without driving the pin.",
      default: false,
    },
    savedCodes: {
      type: "object",
      description:
        'Named codes a message can ask for by id, each {"pulses": [...]}.',
    },
    carrierFrequencyHz: {
      type: "number",
      description:
        "The infrared carrier frequency the LED is modulated at. 38kHz is the most common default across remote protocols; a captured code's original frequency is rarely knowable, so this is a best guess unless measured.",
      unit: "Hz",
      min: 1,
      default: DEFAULT_CARRIER_FREQUENCY_HZ,
    },
  },
};
