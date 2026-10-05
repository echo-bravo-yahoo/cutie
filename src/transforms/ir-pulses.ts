import Transform, {
  Context,
  TransformConfig,
  WholeMessageConfig,
} from "../util/Transform.js";
import Task from "../util/Task.js";
import { HALT } from "../util/Step.js";
import { Message } from "../util/type-helpers.js";
import { ModuleSchema } from "../util/schema.js";

export interface IrPulsesConfig extends WholeMessageConfig {}

interface RawEdge {
  level: number | null;
  tick: number | null;
}

export default class IrPulses extends Transform {
  declare config: IrPulsesConfig;
  honorsTargeting = false;

  constructor(config: IrPulsesConfig, task: Task, index?: number) {
    super(config as unknown as TransformConfig, task, index);
  }

  async doHandleMessage(
    message: Message,
    _traceId: string,
  ): Promise<Message | typeof HALT> {
    if (!Array.isArray(message))
      throw new Error(
        `"transform:ir-pulses" expects an array of {level, tick} edges (chain it after transform:debounce); got ${JSON.stringify(message)}.`,
      );

    // pigpio-client calls back once with (null, null) after endNotify() --
    // trigger:infrared passes that straight through unfiltered when it is
    // the array's own, so drop it here rather than let it corrupt the last
    // duration.
    const edges = (message as Array<RawEdge>).filter(
      (edge) => edge.level !== null && edge.tick !== null,
    ) as Array<{ level: number; tick: number }>;

    const pulses: Array<number> = [];
    for (let i = 1; i < edges.length; i++)
      // pigpio's tick is an unsigned 32-bit microsecond counter that wraps
      // roughly every 72 minutes; ">>> 0" reinterprets the subtraction as
      // unsigned so a wrap doesn't produce a negative duration (same fix as
      // NECFrameDecoder.consumeEdge in adapters/nec.ts).
      pulses.push((edges[i].tick - edges[i - 1].tick) >>> 0);

    return { pulses };
  }

  // no-op for class composition reasons, same as Accumulate.transformSingle
  transformSingle(value: number, _config: IrPulsesConfig, _context: Context) {
    return value;
  }
}

export const schema: ModuleSchema = {
  type: "transform:ir-pulses",
  description:
    "Replaces an array of {level, tick} infrared edges (as transform:debounce buffers from trigger:infrared) with {pulses}: the relative microsecond durations between them, ready for output:infrared.",
  options: {},
};
