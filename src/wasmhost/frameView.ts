import type { Person, PersonState } from "../engine/crowd/person";
import type { EventSystem } from "../engine/EventSystem";
import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import type { Transport, Unit, UnitState, WeatherKind } from "../engine/types";

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

/** The header: the Simulation fields the engine sends every frame, named as
 *  the instance names them so a merge is a plain assignment, plus the tower
 *  revisions, the log cursor, and the record counts that follow. */
export type FrameHeader = Pick<Simulation, "money" | "star" | "weather" | "santaFxSeq" | "explosionFx" | "thiefFx" | "treasureFx" | "vipFxSeq" | "onHourRuns" | "logSeq"> &
  Pick<Tower, "revision" | "mealOverlayRevision"> & {
    minutes: number;
    counts: EventSystem["counts"];
    pending: boolean;
    people: number;
    units: number;
    transports: number;
  };

/** The fixed slots of a person record, before its route (`floors`, then
 *  `shafts`); mirrors `PERSON_FIXED` in `engine-rs/src/wasm.rs`. */
export const PERSON_FIXED = 18;

/** The routines the engine tags a person with, by the code it sends (0 is
 *  none). */
export const ROUTINES: readonly NonNullable<Person["routine"]>[] = ["schoolRun", "salesCall"];

/** The per-frame slice of a {@link Person}: its position and state, and the
 *  routing the suites and the panels read (the origin and venue units, the
 *  meal intent, the routine tag, the return leg, the dwell timer, the route).
 *  `staff` is always present in a frame (the engine sends 0 or 1) where the
 *  instance keeps it optional; the optional unit ids and the timer are
 *  undefined when the engine sends -1, as on the instance. */
export type PersonRecord = Pick<
  Person,
  "id" | "seed" | "state" | "floor" | "x" | "fy" | "wait" | "originFloor" | "originUnitId" | "venueUnitId" | "mealVenueId" | "countedHotelGuest" | "routine" | "returning" | "dwellSecondsLeft" | "floors" | "shafts"
> & { staff: boolean };
// (An absent dwell timer crosses as NaN rather than a sentinel number: the
// timer stays negative on a person through the return leg, so -1 is taken.)

/** The per-frame slice of a {@link Unit}: the counters the engine keeps for
 *  the unit's kind; an absent one reads undefined, as on the instance. */
export type UnitRecord = Pick<Unit, "id" | "state" | "occupants" | "customersIn" | "hotelCustomersIn" | "outForMeal">;

/** The per-frame slice of a {@link Transport}: the car positions, loads, and
 *  directions the renderer animates. */
export type TransportRecord = Pick<Transport, "id" | "cars" | "carPositions" | "carLoad" | "carDir">;

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
  const counter = (n: number) => (n < 0 ? undefined : n);
  // A route length the record reads before it reads the route: a negative
  // or non-integer one would misalign every record after it.
  const routeCount = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 0) throw new Error(`frame view: person record at ${i} has a bad ${what} count ${n}`);
    return n;
  };
  const people: PersonRecord[] = [];
  for (let k = 0; k < header.people; k++) {
    need(PERSON_FIXED);
    const floorCount = routeCount(v[i + 16], "floors");
    const shaftCount = routeCount(v[i + 17], "shafts");
    const routineCode = v[i + 13];
    if (routineCode !== 0 && ROUTINES[routineCode - 1] === undefined) throw new Error(`frame view: unknown routine code ${routineCode}`);
    const record: PersonRecord = {
      id: v[i], seed: v[i + 1], staff: v[i + 2] === 1, state: enumAt(PERSON_STATES, v[i + 3], "person state"), floor: v[i + 4], x: v[i + 5], fy: v[i + 6], wait: v[i + 7],
      originFloor: v[i + 8], originUnitId: counter(v[i + 9]), venueUnitId: counter(v[i + 10]), mealVenueId: counter(v[i + 11]),
      countedHotelGuest: v[i + 12] === 1, routine: routineCode === 0 ? undefined : ROUTINES[routineCode - 1], returning: v[i + 14] === 1, dwellSecondsLeft: Number.isNaN(v[i + 15]) ? undefined : v[i + 15],
      floors: [], shafts: [],
    };
    i += PERSON_FIXED;
    need(floorCount + shaftCount);
    for (let f = 0; f < floorCount; f++) record.floors.push(v[i + f]);
    i += floorCount;
    for (let f = 0; f < shaftCount; f++) record.shafts.push(v[i + f]);
    i += shaftCount;
    people.push(record);
  }
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
