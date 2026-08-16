import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { NECCommand, transmitNECCommand } from "../util/bitbang/adapters/nec.js";
import { Pigpio } from "../util/bitbang/pulse.js";

const DEFAULT_LED_PIN = 23;

// A command as a config or a message writes it: numbers may arrive as hex
// strings, and the extended halves are optional.
export interface RawNECCommand {
  address: number | string;
  command: number | string;
  extendedAddress?: number | string;
  extendedCommand?: number | string;
}

export interface NECConfig extends OutputConfig {
  ledPin?: number;
  virtual?: boolean;
  savedCommands?: Record<string, RawNECCommand>;
}

export default class NEC extends Output {
  declare config: NECConfig;
  pigpio?: Pigpio;

  constructor(config: NECConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: NECConfig): NECConfig {
    return {
      ledPin: DEFAULT_LED_PIN,
      ...config,
    };
  }

  // Number(value, 16) ignores its second argument, so a bare "7c" used to come
  // out NaN and "0x7c" only worked by accident.
  static toNumber(value: number | string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "number") return value;

    const parsed = Number.parseInt(value, 16);
    if (Number.isNaN(parsed))
      throw new Error(`Could not read "${value}" as a hexadecimal number.`);

    return parsed;
  }

  static parseCommand(raw: RawNECCommand): NECCommand {
    const address = NEC.toNumber(raw.address);
    const command = NEC.toNumber(raw.command);

    if (address === undefined || command === undefined)
      throw new Error(
        `An NEC command needs both an address and a command; got ${JSON.stringify(raw)}.`,
      );

    return {
      address,
      command,
      extendedAddress: NEC.toNumber(raw.extendedAddress),
      extendedCommand: NEC.toNumber(raw.extendedCommand),
    };
  }

  resolveCommand(message: Message): NECCommand {
    const body = message as unknown as
      | (RawNECCommand & { id?: string })
      | undefined;

    if (body?.id) {
      const saved = this.config.savedCommands?.[body.id];
      if (!saved)
        throw new Error(
          `No saved NEC command named "${body.id}"; known commands are ${JSON.stringify(Object.keys(this.config.savedCommands || {}))}.`,
        );

      return NEC.parseCommand(saved);
    }

    return NEC.parseCommand(body as RawNECCommand);
  }

  async send(message: Message, traceId: string) {
    const necCommand = this.resolveCommand(message);

    this.info(
      `Transmitting NEC command with address 0x${necCommand.address.toString(16)} and command 0x${necCommand.command.toString(16)}.`,
      { topic: this.logPrefix, traceId },
      { command: necCommand },
    );

    if (this.config.virtual || !this.pigpio) return message;

    await transmitNECCommand(
      this.pigpio,
      necCommand,
      this.config.ledPin ?? DEFAULT_LED_PIN,
    );

    return message;
  }

  async enable() {
    if (!this.config.virtual) {
      this.pigpio = (
        await importOptional<{ default: Pigpio }>("pigpio", "output:nec")
      ).default;
    }

    this.info("Enabled nec.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.pigpio = undefined;
    this.info("Disabled nec.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "output:nec",
  "disabled": false,
  "virtual": false,
  "ledPin": 23,
  "savedCommands": {
    "volumeDown": {
      "address": "0x7c",
      "command": "0x66",
      "extendedAddress": "0xaa"
    }
  }
}

The message either names a saved command, {"id": "volumeDown"}, or spells one
out, {"address": "0x7c", "command": "0x66"}.
*/
