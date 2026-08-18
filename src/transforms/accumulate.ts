import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { HALT } from "../util/Step.js";
import { parseDuration } from "../util/duration.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface AccumulateConfig extends WholeMessageConfig {
  count: number;
  maxAge?: number | string;
}

export default class Accumulate extends Transform {
  declare config: AccumulateConfig;
  declare messages: Array<Message>;
  // The batch is the whole message; there is nothing here to target.
  honorsTargeting = false;
  maxAgeMs?: number;
  timer?: NodeJS.Timeout;

  constructor(config: AccumulateConfig, task: Task, index?: number) {
    super(config as unknown as TransformConfig, task, index);
    this.messages = [];
  }

  async register() {
    await super.register();

    if (this.config.maxAge !== undefined)
      this.maxAgeMs = parseDuration(this.config.maxAge, "maxAge");
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    this.messages.push(message);

    if (this.messages.length >= this.config.count) return this.take();

    this.startTimer();

    return HALT;
  }

  // Whichever limit is reached first empties the batch and cancels the other.
  take(): Array<Message> {
    const batch = this.messages;
    this.messages = [];

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    return batch;
  }

  startTimer() {
    if (this.maxAgeMs === undefined || this.timer) return;

    this.timer = setTimeout(() => this.flush(), this.maxAgeMs);
    // A batch waiting to age out is not a reason to keep the process alive.
    this.timer.unref?.();
  }

  // A timed or shutdown flush has no caller to return the batch to, so it hands
  // it to the rest of the chain itself.
  async flush() {
    if (!this.messages.length) return;

    const batch = this.take();

    if (this.next) await this.next.handleMessage(batch);
    else await this.endMessage(batch);
  }

  async disable() {
    // Without this a restart drops every message gathered since the last batch.
    await this.flush();
    this.enabled = false;
  }

  // no-op for class composition reasons
  transformSingle(value: number, _config: AccumulateConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:accumulate",
  description:
    "Holds messages back and passes them on as one array, either once enough have arrived or once the oldest has waited long enough.",
  options: {
    count: {
      type: "number",
      description: "How many messages make a batch.",
      required: true,
      min: 1,
      integer: true,
    },
    maxAge: {
      type: "any",
      description:
        'How long a partial batch may wait before being passed on anyway, as a number of milliseconds or a string with a unit such as "5m". Without it, a slow topic can hold a batch indefinitely.',
      unit: "ms",
    },
  },
};
