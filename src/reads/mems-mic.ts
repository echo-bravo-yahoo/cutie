import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import DrunkReader, { DrunkSoundLevel } from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

const execFileAsync = promisify(execFile);

export interface MemsMicConfig extends ReadConfig {
  alsaDevice: string;
  captureSeconds?: number;
}

interface Sample {
  metadata: {
    timestamp: Date;
  };
  soundLevel: number;
}

const WAV_HEADER_BYTES = 44;
const FULL_SCALE = 32768; // magnitude ceiling of a 16-bit signed PCM sample

// Relative to full scale, not calibrated dB SPL: an uncalibrated MEMS mic has
// no basis for an absolute reading. Exported so a test can assert the
// RMS/dBFS math directly, independent of arecord.
export function dbfsFrom(pcm: Buffer): number {
  const sampleCount = Math.floor((pcm.length - WAV_HEADER_BYTES) / 2);
  if (sampleCount <= 0) return -Infinity;

  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE(WAV_HEADER_BYTES + index * 2);
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  return rms > 0 ? 20 * Math.log10(rms / FULL_SCALE) : -Infinity;
}

export default class MemsMic extends Read {
  declare config: MemsMicConfig;
  virtualSoundLevel: DrunkReader;

  constructor(config: MemsMicConfig, task: Task, index?: number) {
    super(config, task, index);

    this.virtualSoundLevel = new DrunkSoundLevel();

    this.name = "mems-mic";
  }

  async virtualRead() {
    return {
      metadata: {
        timestamp: new Date(),
      },
      soundLevel: await this.virtualSoundLevel.read(),
    };
  }

  // The base class routes to virtualRead when `virtual` is set, and a
  // disabled step is no longer in the chain at all, so neither guard belongs
  // here.
  async read(_message: Message, traceId: string) {
    const captureFile = join(tmpdir(), `cutie-mems-mic-${randomUUID()}.wav`);

    // The capture file is removed whether or not arecord produced one, so a
    // failed capture leaves nothing in the temp directory. The failure itself
    // belongs to the runtime: the trigger contains it, and a `rescue` decides
    // what a skipped reading should become.
    try {
      await execFileAsync("arecord", [
        "-D",
        this.config.alsaDevice,
        "-f",
        "S16_LE",
        "-r",
        "48000",
        "-c",
        "1",
        "-d",
        String(this.config.captureSeconds),
        captureFile,
      ]);

      const pcm = await readFile(captureFile);
      const datapoint: Sample = {
        metadata: {
          timestamp: new Date(),
        },
        soundLevel: dbfsFrom(pcm),
      };

      this.debug(
        `Sampled new data point, ${JSON.stringify(datapoint, null, 2)}`,
        { traceId },
      );

      return datapoint;
    } finally {
      await rm(captureFile, { force: true });
    }
  }

  async enable() {
    // arecord is a fresh subprocess per read(), unlike a kept-open I2C/SPI
    // handle, so there is no persistent resource to open here.
    this.info("Enabled mems-mic.");
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled mems-mic.");
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:mems-mic",
  description:
    "Reads a sound level from a MEMS I2S digital microphone, over ALSA.",
  options: {
    virtual: {
      type: "boolean",
      description: "Fake the level instead of capturing audio.",
      default: false,
    },
    alsaDevice: {
      type: "string",
      description: 'The ALSA capture device, e.g. "plughw:CARD=<id>,DEV=0".',
      required: true,
    },
    captureSeconds: {
      type: "number",
      description: "Length of the capture each read performs.",
      default: 2,
      min: 1,
      integer: true,
    },
  },
};
