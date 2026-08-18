import Task from "../util/Task.js";
import Transform, {
  targetingOptions,
  Context,
  MultiConfig,
  SingleConfig,
} from "../util/Transform.js";
import { ModuleSchema } from "../util/schema.js";

type Dimension = "temperature" | "pressure" | "length";

// A pressure or a length converts by the ratio of its two units' sizes, so one
// number per unit says everything. Temperature does not: every pair needs its
// own affine formula. Routing temperature through a base unit instead would be
// tidier and slightly wrong -- 21.1 celsius would stop coming out as exactly
// 69.98 fahrenheit.
const SCALED: Record<string, { dimension: Dimension; inBase: number }> = {
  pascal: { dimension: "pressure", inBase: 1 },
  hectopascal: { dimension: "pressure", inBase: 100 },
  millibar: { dimension: "pressure", inBase: 100 },
  kilopascal: { dimension: "pressure", inBase: 1000 },
  bar: { dimension: "pressure", inBase: 100000 },
  atmosphere: { dimension: "pressure", inBase: 101325 },
  psi: { dimension: "pressure", inBase: 6894.757293168361 },
  meter: { dimension: "length", inBase: 1 },
  millimeter: { dimension: "length", inBase: 0.001 },
  centimeter: { dimension: "length", inBase: 0.01 },
  kilometer: { dimension: "length", inBase: 1000 },
  inch: { dimension: "length", inBase: 0.0254 },
  foot: { dimension: "length", inBase: 0.3048 },
  mile: { dimension: "length", inBase: 1609.344 },
};

const AFFINE: Record<string, Record<string, (value: number) => number>> = {
  celsius: {
    fahrenheit: (celsius) => (9 / 5) * celsius + 32,
    kelvin: (celsius) => celsius + 273.15,
  },
  fahrenheit: {
    celsius: (fahrenheit) => (5 / 9) * (fahrenheit - 32),
    kelvin: (fahrenheit) => (5 / 9) * (fahrenheit - 32) + 273.15,
  },
  kelvin: {
    celsius: (kelvin) => kelvin - 273.15,
    fahrenheit: (kelvin) => (9 / 5) * (kelvin - 273.15) + 32,
  },
};

export const UNITS = [...Object.keys(AFFINE), ...Object.keys(SCALED)];

function dimensionOf(unit: string): Dimension | undefined {
  if (AFFINE[unit]) return "temperature";

  return SCALED[unit]?.dimension;
}

export interface ConvertArgs {
  from: string;
  to: string;
}

interface SinglePathConvertConfig extends ConvertArgs, SingleConfig {}

interface MultiPathConvertConfig extends MultiConfig {
  paths: Record<string, ConvertArgs>;
}

export type ConvertConfig = SinglePathConvertConfig | MultiPathConvertConfig;

export default class Convert extends Transform {
  constructor(config: ConvertConfig, task: Task, index?: number) {
    super(config, task, index);
  }

  async register() {
    await super.register();

    for (const { path, args } of this.eachTargetArgs()) {
      const where = path ? ` at path "${path}"` : "";
      const from = String(args.from);
      const to = String(args.to);
      const fromDimension = dimensionOf(from);
      const toDimension = dimensionOf(to);

      for (const [name, unit, dimension] of [
        ["from", from, fromDimension],
        ["to", to, toDimension],
      ] as const)
        if (dimension === undefined)
          throw new Error(
            `"transform:convert": "${name}" is "${unit}"${where}, which is not one of: ${UNITS.join(", ")}.`,
          );

      if (fromDimension !== toDimension)
        throw new Error(
          `"transform:convert": cannot convert ${from} (${fromDimension}) to ${to} (${toDimension})${where}.`,
        );

      if (from === to)
        throw new Error(
          `"transform:convert": "from" and "to" are both "${from}"${where}, so the conversion would do nothing.`,
        );
    }
  }

  transformSingle(
    value: number,
    config: SinglePathConvertConfig,
    _context: Context,
  ) {
    // register() has already proved both units exist and share a dimension.
    const affine = AFFINE[config.from];
    if (affine) return affine[config.to](value);

    return (value * SCALED[config.from].inBase) / SCALED[config.to].inBase;
  }
}

export const schema: ModuleSchema = {
  type: "transform:convert",
  description:
    "Converts a number from one unit to another within the same dimension: temperature, pressure, or length.",
  options: {
    ...targetingOptions("convert"),
    from: {
      type: "string",
      description: "The unit the value is in now.",
      enum: UNITS,
    },
    to: {
      type: "string",
      description: "The unit to convert the value into.",
      enum: UNITS,
    },
  },
};
