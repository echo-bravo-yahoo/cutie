import DrunkReader, { DrunkLux, DrunkProximity } from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { importOptional } from "../util/optional-dependency.js";
import { ModuleSchema } from "../util/schema.js";

export interface LTR559Config extends ReadConfig {
  i2cAddress: number;
}

interface Sample {
  metadata: {
    timestamp: Date;
  };
  lux: number;
  proximity: number;
}

// Registers, per Pimoroni's reference driver (pimoroni/ltr559-python). This
// driver only polls, so the interrupt/threshold registers are never touched.
const REG_ALS_CONTROL = 0x80;
const REG_PS_CONTROL = 0x81;
const REG_PS_LED = 0x82;
const REG_PS_N_PULSES = 0x83;
const REG_PS_MEAS_RATE = 0x84;
const REG_ALS_MEAS_RATE = 0x85;
const REG_PART_ID = 0x86;
const REG_ALS_DATA = 0x88;
const REG_PS_DATA = 0x8d;

const PART_ID_EXPECTED = 0x92; // part 0x9, revision 0x2

// Set by the init sequence below - the lux formula divides by these, so a
// change to one of the writes below has to be mirrored here.
const GAIN = 4;
const INTEGRATION_TIME_MS = 50;

// pimoroni/ltr559-python's own lux calibration coefficients, indexed by which
// band the ch1/ch0 ratio falls into.
const CH0_COEFFICIENTS = [17743, 42785, 5926, 0];
const CH1_COEFFICIENTS = [-11059, 19548, -1185, 0];

// i2c-bus ships no types, so only the members used here are named.
interface I2CBus {
  writeByteSync: (addr: number, cmd: number, byte: number) => void;
  readByteSync: (addr: number, cmd: number) => number;
  readI2cBlockSync: (
    addr: number,
    cmd: number,
    length: number,
    buffer: Buffer,
  ) => number;
  closeSync: () => void;
}

interface I2CBusModule {
  openSync: (busNumber: number) => I2CBus;
}

function lux(ch0: number, ch1: number) {
  const sum = ch0 + ch1;
  const ratio = sum > 0 ? (ch1 * 100) / sum : 101;
  const index = ratio < 45 ? 0 : ratio < 64 ? 1 : ratio < 85 ? 2 : 3;

  return (
    (ch0 * CH0_COEFFICIENTS[index] - ch1 * CH1_COEFFICIENTS[index]) /
    (INTEGRATION_TIME_MS / 100) /
    GAIN /
    10000
  );
}

export default class LTR559 extends Read {
  declare config: LTR559Config;
  bus?: I2CBus;
  virtualLux: DrunkReader;
  virtualProximity: DrunkReader;

  constructor(config: LTR559Config, task: Task, index?: number) {
    super(config, task, index);

    this.virtualLux = new DrunkLux();
    this.virtualProximity = new DrunkProximity();

    this.name = "LTR559";
  }

  async virtualRead() {
    return {
      metadata: {
        timestamp: new Date(),
      },
      lux: await this.virtualLux.read(),
      proximity: await this.virtualProximity.read(),
    };
  }

  // The base class routes to virtualRead when `virtual` is set, and a
  // disabled step is no longer in the chain at all, so neither guard belongs
  // here.
  async read(_message: Message, traceId: string) {
    const bus = this.bus as I2CBus;
    const address = Number(this.config.i2cAddress) || 0x23;

    const alsData = Buffer.alloc(4);
    bus.readI2cBlockSync(address, REG_ALS_DATA, 4, alsData);
    const ch1 = alsData.readUInt16LE(0);
    const ch0 = alsData.readUInt16LE(2);

    const psData = Buffer.alloc(2);
    bus.readI2cBlockSync(address, REG_PS_DATA, 2, psData);
    const proximity = psData[0] | ((psData[1] & 0x07) << 8);

    const datapoint: Sample = {
      metadata: {
        timestamp: new Date(),
      },
      lux: lux(ch0, ch1),
      proximity,
    };

    this.debug(
      `Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`,
      { traceId },
    );

    return datapoint;
  }

  async enable() {
    if (!this.config.virtual) {
      const i2cBus = await importOptional<I2CBusModule>(
        "i2c-bus",
        "read:ltr559",
      );
      this.bus = i2cBus.openSync(1);

      const address = Number(this.config.i2cAddress) || 0x23;
      const partId = this.bus.readByteSync(address, REG_PART_ID);
      if (partId !== PART_ID_EXPECTED) {
        throw new Error(
          `read:ltr559 expected part id 0x${PART_ID_EXPECTED.toString(16)} at register 0x${REG_PART_ID.toString(16)}, but got 0x${partId.toString(16)}. Is an LTR-559 actually at address 0x${address.toString(16)}?`,
        );
      }

      this.bus.writeByteSync(address, REG_ALS_CONTROL, 0x02); // sw_reset
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.bus.writeByteSync(address, REG_PS_LED, 0x1b); // 30kHz, 100% duty, 50mA
      this.bus.writeByteSync(address, REG_PS_N_PULSES, 0x01);
      this.bus.writeByteSync(address, REG_ALS_CONTROL, 0x09); // active, gain 4x
      this.bus.writeByteSync(address, REG_PS_CONTROL, 0x23); // active, saturation indicator
      this.bus.writeByteSync(address, REG_PS_MEAS_RATE, 0x02); // 100ms
      this.bus.writeByteSync(address, REG_ALS_MEAS_RATE, 0x08); // 50ms integration, 50ms repeat
    }

    this.info("Enabled ltr559.");
    this.enabled = true;
  }

  async disable() {
    if (this.bus) this.bus.closeSync();
    this.info("Disabled ltr559.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:ltr559",
  description: "Reads ambient light and proximity from an LTR-559 over I2C.",
  options: {
    virtual: {
      type: "boolean",
      description:
        "Produce plausible drifting readings instead of opening the sensor.",
      default: false,
    },
    i2cAddress: {
      type: "number",
      description: "The sensor's I2C address.",
      default: 0x23,
      // 0x00 to 0x07 are reserved by the I2C spec, so no device answers there.
      min: 0x08,
      max: 0x77,
      integer: true,
    },
  },
};
