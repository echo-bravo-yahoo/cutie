import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { HALT } from "../util/Step.js";
import { Message } from "../util/type-helpers.js";

export interface AccumulateConfig extends WholeMessageConfig {
  count: number;
}

export default class Accumulate extends Transform {
  declare config: AccumulateConfig;
  declare messages: Array<Message>;

  constructor(config: AccumulateConfig, task: Task) {
    super(config as unknown as TransformConfig, task);
    this.messages = [];
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    this.messages.push(message);
    if (this.messages.length < this.config.count) return HALT;

    const batch = this.messages;
    this.messages = [];

    return batch;
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
