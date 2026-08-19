import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { ModuleSchema } from "../util/schema.js";

// serialport and thermalprinter are optional dependencies, and thermalprinter
// ships no types at all.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SerialPortInstance = any;
type PrinterInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ThermalPrinterConfig extends OutputConfig {
  // devicePath, not path: everywhere else in a config a "path" is a filesystem
  // path, and this is a serial device.
  devicePath: string;
  baudRate?: number;
  heatingTime?: number;
  heatingInterval?: number;
  commandDelay?: number;
  chineseFirmware?: boolean;
  virtual?: boolean;
}

// A markdown-ish line prefix and the printer calls that render it.
const HEADINGS: Array<{
  prefix: string;
  render(printer: PrinterInstance, text: string): void;
}> = [
  {
    prefix: "###### ",
    render: (printer, text) =>
      printer.small(true).bold(true).printLine(text).small(false).bold(false),
  },
  {
    prefix: "##### ",
    render: (printer, text) => printer.printLine(text),
  },
  {
    prefix: "#### ",
    render: (printer, text) =>
      printer.underline(1).printLine(text).underline(0),
  },
  {
    prefix: "### ",
    render: (printer, text) =>
      printer.underline(6).printLine(text).underline(0),
  },
  {
    prefix: "## ",
    render: (printer, text) => printer.big(true).printLine(text).big(false),
  },
  {
    prefix: "# ",
    render: (printer, text) =>
      printer.bold(true).big(true).printLine(text).bold(false).big(false),
  },
];

export default class ThermalPrinter extends Output {
  declare config: ThermalPrinterConfig;
  serialPort?: SerialPortInstance;
  printer?: PrinterInstance;

  constructor(config: ThermalPrinterConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  // `path` used to be this module's name for the serial device, which collided
  // with every other module's filesystem `path`. And devicePath is required
  // only when a device is actually opened, which is a pairing no single
  // option's schema can express.
  async register() {
    if ((this.config as { path?: unknown }).path !== undefined)
      throw new Error(
        `"output:thermal-printer" does not accept "path"; use "devicePath" for the serial device.`,
      );

    if (!this.config.virtual && this.config.devicePath === undefined)
      throw new Error(
        `"output:thermal-printer" needs a "devicePath" naming the serial device, or "virtual": true.`,
      );
  }

  // Longest prefix first, so "## " does not swallow a "### " line.
  processLine(line: string) {
    const heading = HEADINGS.find((candidate) =>
      line.startsWith(candidate.prefix),
    );

    if (heading) {
      heading.render(this.printer, line.slice(heading.prefix.length));
    } else if (line.startsWith("- ")) {
      this.printer.small(true).printLine(`  ${line}`).small(false);
    } else {
      this.printer.small(true).printLine(line).small(false);
    }
  }

  async send(message: Message, traceId: string) {
    const text =
      typeof message === "string" ? message : JSON.stringify(message);

    if (this.config.virtual) {
      this.info(`Would print (virtual):\n${text}`, { traceId });

      return message;
    }

    if (!this.printer) {
      this.error("Cannot print; the thermal printer is not enabled.", {
        traceId,
      });

      return message;
    }

    for (const line of text.split("\n")) {
      this.printer.reset();
      this.processLine(line);
    }
    // feed past the tear bar
    this.printer.printLine("\n\n\n");

    await new Promise<void>((resolve) => this.printer.print(() => resolve()));
    this.info("Printed a message.", { traceId });

    return message;
  }

  async enable() {
    if (!this.config.virtual) {
      const { SerialPort } = await importOptional<{
        SerialPort: new (options: object) => SerialPortInstance;
      }>("serialport", "output:thermal-printer");
      const { default: Printer } = await importOptional<{
        default: new (
          port: SerialPortInstance,
          options: object,
        ) => PrinterInstance;
      }>("thermalprinter", "output:thermal-printer");

      this.info("Enabling thermal printer...");

      await new Promise<void>((resolve, reject) => {
        this.serialPort = new SerialPort({
          path: this.config.devicePath,
          baudRate: this.config.baudRate,
        });

        this.serialPort.on("error", (error: Error) =>
          this.error(`Thermal printer serial error: ${error}.`),
        );

        this.serialPort.on("open", () => {
          // chineseFirmware is left out entirely when a config does not set
          // it, rather than passed as undefined: the vendor reads it with
          // `||`, so its own default only applies to an absent key.
          this.printer = new Printer(this.serialPort, {
            heatingTime: this.config.heatingTime,
            heatingInterval: this.config.heatingInterval,
            commandDelay: this.config.commandDelay,
            ...(this.config.chineseFirmware === undefined
              ? {}
              : { chineseFirmware: this.config.chineseFirmware }),
          });

          this.printer.on("ready", () => resolve());
          this.printer.on("error", (error: Error) => reject(error));
        });
      });
    }

    this.info("Enabled thermal printer.");
    this.enabled = true;
  }

  async disable() {
    this.printer = undefined;
    if (this.serialPort) {
      this.serialPort.close();
      this.serialPort = undefined;
    }
    this.info("Disabled thermal printer.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "output:thermal-printer",
  description:
    'Prints each message on a serial thermal printer, a line at a time. A line may lead with "# " through "###### " for a heading, or "- " for a list item.',
  options: {
    devicePath: {
      type: "string",
      description:
        'The serial device the printer is on, such as "/dev/ttyS0". Required unless virtual is set; there is no sensible default for someone else\'s wiring.',
    },
    baudRate: {
      type: "number",
      description: "The serial baud rate the printer expects.",
      default: 19200,
      min: 1,
      integer: true,
    },
    heatingTime: {
      type: "number",
      description: "How long each heating pulse lasts.",
      default: 240,
      unit: "10 microseconds",
    },
    heatingInterval: {
      type: "number",
      description: "How long to wait between heating pulses.",
      default: 160,
      unit: "10 microseconds",
    },
    commandDelay: {
      type: "number",
      description: "How long to wait between commands sent to the printer.",
      default: 120,
      unit: "microseconds",
    },
    chineseFirmware: {
      type: "boolean",
      description:
        "Set only if the printer runs the Chinese firmware variant. Left unset, the vendor library's own default applies.",
    },
    virtual: {
      type: "boolean",
      description:
        "Log what would be printed without opening the serial device.",
      default: false,
    },
  },
};
