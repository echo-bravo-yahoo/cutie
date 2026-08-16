import { Message } from "./type-helpers.js";

export interface DrunkReaderConfig {
  minStep: number;
  maxStep: number;
  max: number;
  min: number;
  start: number;
}

export default class DrunkReader {
  config: DrunkReaderConfig;
  lastNumber: number;

  constructor(config: DrunkReaderConfig) {
    this.config = config;
    this.lastNumber = config.start || 0;
  }

  generateNextNumber() {
    const min = this.config.minStep;
    const max = this.config.maxStep;
    const step = Math.random() * (max - min) + min;
    const parity = Math.random() > 0.5 ? +1 : -1;
    let result = this.lastNumber;
    if (this.lastNumber + parity * step >= this.config.max) {
      result = this.lastNumber - parity * step;
    } else if (this.lastNumber + parity * step <= this.config.min) {
      result = this.lastNumber - parity * step;
    } else {
      result = this.lastNumber + parity * step;
    }

    this.lastNumber = result;
    return result;
  }

  async read(): Promise<Message> {
    return this.generateNextNumber();
  }
}

export class DrunkTemp extends DrunkReader {
  constructor() {
    super({
      min: 18,
      max: 35,
      minStep: 0.05,
      maxStep: 0.1,
      start: 22,
    });
  }
}

export class DrunkHumidity extends DrunkReader {
  constructor() {
    super({
      min: 0,
      max: 100,
      minStep: 0.5,
      maxStep: 3,
      start: 20,
    });
  }
}

export class DrunkPressure extends DrunkReader {
  constructor() {
    super({
      min: 400,
      max: 1050,
      minStep: 1,
      maxStep: 10,
      start: 1000,
    });
  }
}

// Gas resistance is reported in ohms, so it walks a range orders of magnitude
// above the other measurements.
export class DrunkGasResistance extends DrunkReader {
  constructor() {
    super({
      min: 5000,
      max: 50000,
      minStep: 50,
      maxStep: 500,
      start: 20000,
    });
  }
}

// RSSI walks in dBm: closer to 0 is a stronger signal, more negative is
// weaker, roughly the range a real BLE advertisement reports at close to
// long range.
export class DrunkRSSI extends DrunkReader {
  constructor() {
    super({
      min: -95,
      max: -40,
      minStep: 1,
      maxStep: 4,
      start: -65,
    });
  }
}
