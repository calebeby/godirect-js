import { EventEmitter } from "./utils.js";

export class MeasurementInfo {
  type: number;
  mode: number;
  minValue: number;
  maxValue: number;
  uncertainty: number;
  minPeriod: number;
  maxPeriod: number;
  typicalPeriod: number;
  granularity: number;
  constructor(args: {
    type: number;
    mode: number;
    minValue: number;
    maxValue: number;
    uncertainty: number;
    minPeriod: number;
    maxPeriod: number;
    typicalPeriod: number;
    granularity: number;
  }) {
    this.type = args.type; // 0 = Real64 or 1 = Int32
    this.mode = args.mode; // 0 = Periodic, 1 = APeriodic
    this.minValue = args.minValue; // sensor units
    this.maxValue = args.maxValue; // sensor units
    this.uncertainty = args.uncertainty; // sensor units
    this.minPeriod = args.minPeriod; // milliseconds
    this.maxPeriod = args.maxPeriod; // milliseconds
    this.typicalPeriod = args.typicalPeriod; // milliseconds
    this.granularity = args.granularity; // milliseconds
  }
}

export class SensorSpecs {
  number: number;
  name: string;
  unit: string;
  mutalExclusionMask: number;
  measurementInfo: MeasurementInfo;
  id: number;
  constructor(args: {
    number: number;
    name: string;
    unit: string;
    mutalExclusionMask: number;
    measurementInfo: MeasurementInfo;
    id: number;
  }) {
    this.number = args.number;
    this.name = args.name;
    this.unit = args.unit;
    this.id = args.id;
    this.mutalExclusionMask = args.mutalExclusionMask;
    this.measurementInfo = args.measurementInfo;
  }
}

export class Sensor extends EventEmitter<{
  "state-changed": Sensor;
  "value-changed": Sensor;
}> {
  value: number | null;
  values: number[];
  enabled: boolean;
  number: any;
  name: string;
  unit: string;
  specs: SensorSpecs;
  constructor(specs: SensorSpecs) {
    super();
    this.number = specs.number;
    this.name = specs.name;
    this.unit = specs.unit;
    this.specs = specs;
    this.enabled = false;
    this.values = [];
    this.value = null;
  }

  /** Clear out the accumulated values */
  clear() {
    this.value = null;
    this.values = [];
  }

  /** Set the latest value and tell people about it. */
  setValue(value: number, keep: boolean) {
    this.value = value; // latest
    if (keep) {
      this.values.push(this.value);
    }
    this.emit("value-changed", this);
  }

  /** Enable the sensor and tell people about it. */
  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.emit("state-changed", this);
    }
  }
}
