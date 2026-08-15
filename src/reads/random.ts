import DrunkReader, { DrunkReaderConfig } from "../util/DrunkReader.js";
import Read, { ReadConfig } from "../util/Read.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface RandomConfig extends ReadConfig, DrunkReaderConfig {}

export default class Random extends Read {
  declare config: RandomConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare samples: Array<any>;
  reader: DrunkReader;

  constructor(config: RandomConfig, task: Task) {
    super(config, task);

    this.reader = new DrunkReader(config);
    this.name = "random";
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

/*
{
  "type": "read:random",
  "disabled": false,
  "start": 22,
  "minStep": .05,
  "maxStep": .5,
  "max": 30,
  "min": 20,
}
*/
