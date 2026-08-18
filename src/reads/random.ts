import DrunkReader, { DrunkReaderConfig } from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface RandomConfig extends ReadConfig, DrunkReaderConfig {}

export default class Random extends Read {
  declare config: RandomConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare samples: Array<any>;
  reader: DrunkReader;

  constructor(config: RandomConfig, task: Task, index?: number) {
    super(config, task, index);

    // this.config rather than the argument: the schema's defaults and
    // deprecated-name normalization have been applied to it.
    this.reader = new DrunkReader(this.config);
    this.name = "random";
  }

  // The bounds are pairs, which no single option's schema can express. The base
  // class handles `virtual`, which this module reads nothing external to fake.
  async register() {
    await super.register();

    if (this.config.min >= this.config.max)
      throw new Error(
        `"read:random": "min" (${this.config.min}) should be less than "max" (${this.config.max}).`,
      );

    if (this.config.minStep >= this.config.maxStep)
      throw new Error(
        `"read:random": "minStep" (${this.config.minStep}) should be less than "maxStep" (${this.config.maxStep}).`,
      );
  }

  async read(_message: Message, _traceId: string) {
    return this.reader.read();
  }

  async enable() {
    this.info("Enabled random number module.", { topic: this.logPrefix });
    this.enabled = true;
  }

  async disable() {
    this.info("Disabled random number module.", { topic: this.logPrefix });
    this.enabled = false;
  }
}

export const schema: ModuleSchema = {
  type: "read:random",
  description:
    "Replaces the message with a number that drifts within bounds, one step at a time. This is the way to build a sensor-shaped task with no hardware attached.",
  options: {
    min: {
      type: "number",
      description: "The lowest value a reading may take.",
      required: true,
    },
    max: {
      type: "number",
      description: "The highest value a reading may take.",
      required: true,
    },
    minStep: {
      type: "number",
      description: "The smallest change between consecutive readings.",
      required: true,
    },
    maxStep: {
      type: "number",
      description: "The largest change between consecutive readings.",
      required: true,
    },
    start: {
      type: "number",
      description: "The value the first reading drifts away from.",
      required: true,
    },
  },
};
