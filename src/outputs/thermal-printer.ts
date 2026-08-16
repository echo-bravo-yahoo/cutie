import Output, { OutputConfig } from "../util/Output.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";

// serialport and thermalprinter are optional dependencies, and thermalprinter
// ships no types at all.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SerialPortInstance = any;
type PrinterInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ThermalPrinterConfig extends OutputConfig {
  path?: string;
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

  constructor(config: ThermalPrinterConfig, task: Task) {
    super(config, task);
  }

  addDefaultsToConfig(config: ThermalPrinterConfig): ThermalPrinterConfig {
    return {
      path: "/dev/ttyS0",
      baudRate: 19200,
      heatingTime: 240,
      heatingInterval: 160,
      commandDelay: 120,
      chineseFirmware: true,
      ...config,
    };
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
    const text = typeof message === "string" ? message : JSON.stringify(message);

    if (this.config.virtual) {
      this.info(`Would print (virtual):\n${text}`, {
        topic: this.logPrefix,
        traceId,
      });

      return message;
    }

    if (!this.printer) {
      this.error("Cannot print; the thermal printer is not enabled.", {
        topic: this.logPrefix,
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
    this.info("Printed a message.", { topic: this.logPrefix, traceId });

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

      this.info("Enabling thermal printer...", { topic: this.logPrefix });

      await new Promise<void>((resolve, reject) => {
        this.serialPort = new SerialPort({
          path: this.config.path,
          baudRate: this.config.baudRate,
        });

        this.serialPort.on("error", (error: Error) =>
          this.error(`Thermal printer serial error: ${error}.`, {
            topic: this.logPrefix,
          }),
        );

        this.serialPort.on("open", () => {
          this.printer = new Printer(this.serialPort, {
            heatingTime: this.config.heatingTime,
            heatingInterval: this.config.heatingInterval,
            commandDelay: this.config.commandDelay,
            chineseFirmware: this.config.chineseFirmware,
          });

          this.printer.on("ready", () => resolve());
          this.printer.on("error", (error: Error) => reject(error));
        });
      });
    }

    this.info("Enabled thermal printer.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.printer = undefined;
    if (this.serialPort) {
      this.serialPort.close();
      this.serialPort = undefined;
    }
    this.info("Disabled thermal printer.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

/*
{
  "type": "output:thermal-printer",
  "disabled": false,
  "virtual": false,
  "path": "/dev/ttyS0",
  "baudRate": 19200,
  "heatingTime": 240,
  "heatingInterval": 160,
  "commandDelay": 120,
  "chineseFirmware": true
}

The message is printed a line at a time; a line may lead with "# " through
"###### " for headings, or "- " for a list item.
*/
