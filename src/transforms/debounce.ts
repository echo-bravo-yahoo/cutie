import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { HALT } from "../util/Step.js";
import { newTraceId } from "../util/trace.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface DebounceConfig extends WholeMessageConfig {
  idleMs: number;
}

export default class Debounce extends Transform {
  declare config: DebounceConfig;
  declare messages: Array<Message>;
  // The batch is the whole message; there is nothing here to target.
  honorsTargeting = false;
  timer?: NodeJS.Timeout;

  constructor(config: DebounceConfig, task: Task, index?: number) {
    super(config as unknown as TransformConfig, task, index);
    this.messages = [];
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    this.messages.push(message);
    this.resetTimer();
    return HALT;
  }

  // Every message restarts the wait, unlike transform:accumulate's maxAge,
  // which starts counting from the first message in a batch.
  resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.config.idleMs);
    // A batch waiting to go idle is not a reason to keep the process alive.
    this.timer.unref?.();
  }

  take(): Array<Message> {
    const batch = this.messages;
    this.messages = [];

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    return batch;
  }

  // A timed or shutdown flush has no caller to return the batch to, so it
  // hands it to the rest of the chain itself. It also has no incoming
  // message to inherit a trace from, so the batch starts one of its own.
  async flush() {
    if (!this.messages.length) return;

    const batch = this.take();
    const traceId = newTraceId();

    if (this.next) await this.next.handleMessage(batch, traceId);
    else await this.endMessage(batch, traceId);
  }

  async disable() {
    // Without this a restart drops every message gathered since the last
    // flush.
    await this.flush();
    this.enabled = false;
  }

  // no-op for class composition reasons, same as Accumulate.transformSingle
  transformSingle(value: number, _config: DebounceConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:debounce",
  description:
    "Holds messages back and passes them on as one array once nothing new has arrived for idleMs. Unlike transform:accumulate, there is no count or max-age escape hatch: a steady stream faster than idleMs never flushes.",
  options: {
    idleMs: {
      type: "number",
      description: "How long a quiet period must last before flushing.",
      required: true,
      unit: "ms",
      min: 1,
    },
  },
};
