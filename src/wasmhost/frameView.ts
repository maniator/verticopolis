import type { PersonState } from "../engine/crowd/person";
import type { UnitState, WeatherKind } from "../engine/types";

/**
 * The engine's per-frame read model, decoded from the flat number array
 * `Engine.frameView()` returns. The layout is fixed by `frame_view` in
 * `engine-rs/src/wasm.rs`; the header slots and the record widths here
 * mirror it one for one.
 */
export const FRAME_HEADER = 26;

export const PERSON_STATES: readonly PersonState[] = ["toShaft", "waiting", "riding", "climbing", "toDest", "dwelling", "done"];
export const UNIT_STATES: readonly UnitState[] = ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "dirty", "infested", "fire", "gutted"];
export const WEATHERS: readonly WeatherKind[] = ["clear", "cloudy", "rain"];

export interface FrameHeader {
  minutes: number;
  revision: number;
  mealOverlayRevision: number;
  logSeq: number;
  money: number;
  star: number;
  weather: WeatherKind;
  santaFxSeq: number;
  explosionFx: { seq: number; floor: number; x: number };
  thiefFx: { seq: number; caught: boolean; floor: number };
  treasureFx: { seq: number; floor: number; x: number };
  vipFxSeq: number;
  counts: { fires: number; firesGutRooms: number; bombs: number };
  pending: boolean;
  onHourRuns: number;
  people: number;
  units: number;
  transports: number;
}

export interface PersonRecord {
  id: number;
  seed: number;
  staff: boolean;
  state: PersonState;
  floor: number;
  x: number;
  fy: number;
  wait: number;
}

export interface UnitRecord {
  id: number;
  state: UnitState;
  occupants: number;
  /** An absent counter (the engine keeps none for this unit) reads undefined. */
  customersIn: number | undefined;
  hotelCustomersIn: number | undefined;
  outForMeal: number | undefined;
}

export interface TransportRecord {
  id: number;
  cars: number;
  carPositions: number[];
  /** Undefined when the shaft keeps no load. */
  carLoad: number[] | undefined;
  carDir: number[];
}

export interface FrameView {
  header: FrameHeader;
  people: PersonRecord[];
  units: UnitRecord[];
  transports: TransportRecord[];
}

/** Decode one frame view. Throws when the array is shorter than its
 *  header says, so a binding that changed its layout fails by name. */
export function decodeFrame(v: ArrayLike<number>): FrameView {
  if (v.length < FRAME_HEADER) throw new Error(`frame view: ${v.length} numbers, header needs ${FRAME_HEADER}`);
  const enumAt = <T>(table: readonly T[], code: number, what: string): T => {
    const t = table[code];
    if (t === undefined) throw new Error(`frame view: unknown ${what} code ${code}`);
    return t;
  };
  const header: FrameHeader = {
    minutes: v[0],
    revision: v[1],
    mealOverlayRevision: v[2],
    logSeq: v[3],
    money: v[4],
    star: v[5],
    weather: enumAt(WEATHERS, v[6], "weather"),
    santaFxSeq: v[7],
    explosionFx: { seq: v[8], floor: v[9], x: v[10] },
    thiefFx: { seq: v[11], caught: v[12] === 1, floor: v[13] },
    treasureFx: { seq: v[14], floor: v[15], x: v[16] },
    vipFxSeq: v[17],
    counts: { fires: v[18], firesGutRooms: v[19], bombs: v[20] },
    pending: v[21] === 1,
    onHourRuns: v[22],
    people: v[23],
    units: v[24],
    transports: v[25],
  };
  let i = FRAME_HEADER;
  const need = (n: number) => {
    if (i + n > v.length) throw new Error(`frame view: ${v.length} numbers, record at ${i} needs ${n}`);
  };
  const people: PersonRecord[] = [];
  for (let k = 0; k < header.people; k++) {
    need(8);
    people.push({ id: v[i], seed: v[i + 1], staff: v[i + 2] === 1, state: enumAt(PERSON_STATES, v[i + 3], "person state"), floor: v[i + 4], x: v[i + 5], fy: v[i + 6], wait: v[i + 7] });
    i += 8;
  }
  const counter = (n: number) => (n < 0 ? undefined : n);
  const units: UnitRecord[] = [];
  for (let k = 0; k < header.units; k++) {
    need(6);
    units.push({ id: v[i], state: enumAt(UNIT_STATES, v[i + 1], "unit state"), occupants: v[i + 2], customersIn: counter(v[i + 3]), hotelCustomersIn: counter(v[i + 4]), outForMeal: counter(v[i + 5]) });
    i += 6;
  }
  const transports: TransportRecord[] = [];
  for (let k = 0; k < header.transports; k++) {
    need(2);
    const id = v[i];
    const cars = v[i + 1];
    i += 2;
    need(3 * cars);
    const carPositions: number[] = [];
    const carLoad: number[] = [];
    const carDir: number[] = [];
    let anyLoad = false;
    for (let c = 0; c < cars; c++) {
      carPositions.push(v[i]);
      if (v[i + 1] >= 0) anyLoad = true;
      carLoad.push(v[i + 1]);
      carDir.push(v[i + 2]);
      i += 3;
    }
    transports.push({ id, cars, carPositions, carLoad: anyLoad ? carLoad : undefined, carDir });
  }
  if (i !== v.length) throw new Error(`frame view: ${v.length - i} numbers left after the last record`);
  return { header, people, units, transports };
}
