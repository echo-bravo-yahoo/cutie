import Step, { HALT, StepConfig } from "./Step.js";
import Task from "./Task.js";
import { Message } from "./type-helpers.js";

export interface ReadConfig extends StepConfig {
  type: string;
  virtual?: boolean;
}

export default abstract class Read extends Step {
  declare config: ReadConfig;
  // A read may return HALT instead of a Message to skip a cycle entirely -
  // e.g. read:mems-mic on a transient capture failure - rather than passing
  // undefined to steps downstream that do not expect it (output:influxdb
  // throws on a non-object message, and nothing in the chain catches that).
  abstract read(
    message: Message,
    traceId: string,
  ): Promise<Message | typeof HALT>;
  // Implemented by the reads that can stand in for their own hardware. Routed
  // instead of read() when `virtual` is true.
  virtualRead?(message: Message, traceId: string): Promise<Message>;

  constructor(config: ReadConfig, task: Task, index?: number) {
    super(config, task, index);

    // A read has no targeting options; only a transform does. Rejecting this
    // here stops a config that looks like it iterates an array from quietly
    // reading a single value instead.
    if ((config as { basePath?: unknown }).basePath !== undefined)
      throw new Error(
        `"${config.type}" does not accept "basePath"; only a transform targets paths.`,
      );
  }

  // A read that stands in for nothing has no use for `virtual`, and saying so
  // at registration beats failing on the first message. Checked here rather
  // than per module so a new read cannot quietly skip the choice.
  async register() {
    if (this.config.virtual !== undefined && !this.virtualRead)
      throw new Error(
        `"${this.config.type}" does not accept "virtual"; it reads no external resource to stand in for.`,
      );
  }

  async doHandleMessage(message: Message, traceId: string) {
    if (!this.config.virtual) return this.read(message, traceId);

    return this.virtualRead!(message, traceId);
  }
}
