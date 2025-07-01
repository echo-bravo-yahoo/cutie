type UserUnit = "c" | "celsius" | "f" | "fahrenheit";
type InternalUnit = "c" | "f";

export class Temp {
  unit: "c" | "f";
  temp: number;
  offset: boolean;

  constructor(temp: number, unit: UserUnit, offset = true) {
    if (unit === undefined)
      throw new Error(
        `Undefined unit (should be one of "c", "celsius", "f", "fahrenheit").`
      );
    this.unit = this.userUnitToInternalUnit(unit);
    this.temp = temp;
    this.offset = !!offset;
    return this;
  }

  userUnitToInternalUnit(userUnit: UserUnit = this.unit): InternalUnit {
    if (["celsius", "c"].includes(userUnit.toLowerCase())) return "c";
    if (["fahrenheit", "f"].includes(userUnit.toLowerCase())) return "f";
    throw new Error(`Could not determine unit for input "${userUnit}".`);
  }

  static ctof(degreesC: number, absolute = true) {
    let offset = absolute ? 32 : 0;
    return (9 / 5) * degreesC + offset;
  }

  static ftoc(degreesF: number, absolute = true) {
    let offset = absolute ? 32 : 0;
    return (5 / 9) * (degreesF - offset);
  }

  // convenience wrapper to flip ftoc or ctof
  static atob(temp: number, unit: InternalUnit, offset = true) {
    if (unit === "f") {
      return Temp.ctof(temp, offset);
    } else if (unit === "c") {
      return Temp.ftoc(temp, offset);
    } else {
      throw new Error(`Could not determine unit for input "${unit}".`);
    }
  }

  to(desiredUnit: UserUnit) {
    desiredUnit = this.userUnitToInternalUnit(desiredUnit);
    if (desiredUnit === this.unit) return this;

    this.temp = Temp.atob(this.temp, desiredUnit, this.offset);
    this.unit = desiredUnit;

    return this;
  }

  add(temp: number, unit: UserUnit) {
    unit = this.userUnitToInternalUnit(unit);
    if (unit === this.unit) {
      this.temp += temp;
    } else {
      this.temp += Temp.atob(temp, this.unit, false);
    }

    return this;
  }

  subtract(temp: number, unit: UserUnit) {
    this.add(-1 * temp, unit);
    return this;
  }

  value(args = { precision: Number.POSITIVE_INFINITY, stepSize: 0 }) {
    const { precision, stepSize } = args;
    let result = this.temp;

    if (stepSize) {
      result = Math.floor(result / stepSize) * stepSize;
    }

    if (precision !== Number.POSITIVE_INFINITY) {
      result = Number(Number(result).toFixed(precision));
    }

    return result;
  }

  toString() {
    return Number(this.temp).toString();
  }
}
