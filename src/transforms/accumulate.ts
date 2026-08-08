import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { Message } from "../util/type-helpers.js";

export interface AccumulateConfig extends WholeMessageConfig {
  count: number;
}

export default class Accumulate extends Transform {
  declare config: AccumulateConfig;
  declare messages: Array<Message>;

  constructor(config: AccumulateConfig, task: Task) {
    super(config as unknown as TransformConfig, task, {});
    this.messages = [];
  }

  transform(message: Message) {
    return new Promise((resolve) => {
      this.messages.push(message);
      if (this.messages.length >= this.config.count) {
        const result = this.messages;
        this.messages = [];
        resolve(result);
      }
    });
  }

  // no-op for class composition reasons
  transformSingle(value: number, _config: AccumulateConfig, _context: Context) {
    return value;
  }
}

/*
whole message form:
{
  "type": "transform:accumulate",
  "count": 5
}
*/
