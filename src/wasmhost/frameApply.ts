import { LOG_RING_CAP } from "../engine/sim/constants";
import type { Simulation } from "../engine/Simulation";
import { markRoom } from "../engine/tower/rooms";
import type { LogEntry } from "../engine/types";
import type { Person } from "../engine/crowd/person";
import { FRAME_HEADER, PERSON_FIXED, PERSON_STATES, ROUTINES, UNIT_STATES, enumAt, type FrameHeader } from "./frameView";
import { PERSON_OPTIONALS, clearOptional } from "./personFields";

/**
 * Apply a frame view's records (the people, the unit counters, the cars) to
 * the read model straight from the engine's number array, without building
 * the intermediate records `decodeFrame` returns. Used by the coalesced and
 * worker hosts; the default host keeps its decode-then-apply path, so the
 * two can be compared. The result is the same instance state as
 * `decodeFrame` followed by the default host's apply (the equivalence test
 * in `frameApply.test.ts` holds it there), with two savings: a route whose
 * floors and shafts did not change is left alone, and a crowd whose order
 * did not change is updated in place without an id index.
 *
 * The whole array is checked before anything is written, as the decode
 * checks it, so a malformed frame leaves the read model untouched.
 */
export function applyRecords(sim: Simulation, v: ArrayLike<number>, h: FrameHeader): void {
  checkRecords(v, h);
  let i = FRAME_HEADER;
  i = applyPeople(sim, v, h.people, i);
  i = applyUnits(sim, v, h.units, i);
  applyCars(sim, v, h.transports, i);
}

/** Walk the records the header counts and refuse, by the decoder's
 *  messages, any count, code or length the decoder would refuse. */
export function checkRecords(v: ArrayLike<number>, h: FrameHeader): void {
  let i = FRAME_HEADER;
  const need = (n: number) => {
    if (i + n > v.length) throw new Error(`frame view: ${v.length} numbers, record at ${i} needs ${n}`);
  };
  const routeCount = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 0) throw new Error(`frame view: person record at ${i} has a bad ${what} count ${n}`);
    return n;
  };
  for (let k = 0; k < h.people; k++) {
    need(PERSON_FIXED);
    const floors = routeCount(v[i + 16], "floors");
    const shafts = routeCount(v[i + 17], "shafts");
    const routine = v[i + 13];
    if (routine !== 0 && ROUTINES[routine - 1] === undefined) throw new Error(`frame view: unknown routine code ${routine}`);
    enumAt(PERSON_STATES, v[i + 3], "person state");
    i += PERSON_FIXED;
    need(floors + shafts);
    i += floors + shafts;
  }
  for (let k = 0; k < h.units; k++) {
    need(6);
    enumAt(UNIT_STATES, v[i + 1], "unit state");
    i += 6;
  }
  for (let k = 0; k < h.transports; k++) {
    need(2);
    const cars = v[i + 1];
    if (!Number.isInteger(cars) || cars < 0) throw new Error(`frame view: bad transport ${v[i]} cars count ${cars}`);
    i += 2;
    need(3 * cars);
    i += 3 * cars;
  }
  if (i !== v.length) throw new Error(`frame view: ${v.length - i} numbers left after the last record`);
}

const counter = (n: number) => (n < 0 ? undefined : n);

/** Make `target` hold `v[from..from+n)`, in place, writing only when it
 *  differs (a holder of the array sees the new legs either way). */
function setRoute(target: number[], v: ArrayLike<number>, from: number, n: number): void {
  let same = target.length === n;
  for (let k = 0; same && k < n; k++) same = target[k] === v[from + k];
  if (same) return;
  target.length = n;
  for (let k = 0; k < n; k++) target[k] = v[from + k];
}

function applyPeople(sim: Simulation, v: ArrayLike<number>, count: number, start: number): number {
  const people = sim.crowd.people;
  // The common case: the same people in the same order as the last frame.
  // The first person out of place switches to an id index over the old crowd
  // and a fresh order, as the default host builds every frame.
  let held: Map<number, Person> | null = null;
  let next: Person[] | null = null;
  let i = start;
  for (let k = 0; k < count; k++) {
    const id = v[i];
    let p: Person | undefined = next === null && people[k]?.id === id ? people[k] : undefined;
    if (!p && next === null) {
      next = people.slice(0, k);
      held = new Map();
      for (const q of people) held.set(q.id, q);
    }
    if (!p) p = held!.get(id);
    const state = PERSON_STATES[v[i + 3]];
    if (!p) {
      // A person first seen in a frame: the same placeholders as the
      // default host (backlog #868 owns the gap).
      p = {
        id, seed: v[i + 1], state, floor: v[i + 4], fy: v[i + 6], x: v[i + 5],
        floors: [], originFloor: v[i + 8], shafts: [], leg: 0, shaftId: null, carIndex: null,
        destX: v[i + 5], wait: v[i + 7], tripWait: 0, age: 0, linger: 0,
      };
    } else {
      p.seed = v[i + 1];
      p.state = state;
      p.floor = v[i + 4];
      p.x = v[i + 5];
      p.fy = v[i + 6];
      p.wait = v[i + 7];
      p.originFloor = v[i + 8];
    }
    const floorCount = v[i + 16];
    const shaftCount = v[i + 17];
    setRoute(p.floors, v, i + PERSON_FIXED, floorCount);
    setRoute(p.shafts, v, i + PERSON_FIXED + floorCount, shaftCount);
    const routineCode = v[i + 13];
    const dwell = v[i + 15];
    const optionals = {
      originUnitId: counter(v[i + 9]),
      venueUnitId: counter(v[i + 10]),
      mealVenueId: counter(v[i + 11]),
      routine: routineCode === 0 ? undefined : ROUTINES[routineCode - 1],
      dwellSecondsLeft: Number.isNaN(dwell) ? undefined : dwell,
    };
    for (const key of PERSON_OPTIONALS) {
      const value = optionals[key];
      if (value === undefined) clearOptional(p, key);
      else (p as Record<typeof key, typeof value>)[key] = value;
    }
    if (v[i + 2] === 1) p.staff = true;
    else clearOptional(p, "staff");
    if (v[i + 12] === 1) p.countedHotelGuest = true;
    else clearOptional(p, "countedHotelGuest");
    if (v[i + 14] === 1) p.returning = true;
    else clearOptional(p, "returning");
    if (next !== null) next.push(p);
    i += PERSON_FIXED + floorCount + shaftCount;
  }
  if (next !== null) people.splice(0, people.length, ...next);
  else if (people.length > count) people.length = count;
  return i;
}

function applyUnits(sim: Simulation, v: ArrayLike<number>, count: number, start: number): number {
  let i = start;
  const byId = sim.tower.byId;
  for (let k = 0; k < count; k++, i += 6) {
    const u = byId.get(v[i]);
    if (!u) continue;
    const state = UNIT_STATES[v[i + 1]];
    const customersIn = counter(v[i + 3]);
    // The HUD's room counts recount a room only when a field they read moved.
    if (u.state !== state || u.customersIn !== customersIn) markRoom(sim.tower, u);
    u.state = state;
    u.occupants = v[i + 2];
    u.customersIn = customersIn;
    u.hotelCustomersIn = counter(v[i + 4]);
    u.outForMeal = counter(v[i + 5]);
  }
  return i;
}

function applyCars(sim: Simulation, v: ArrayLike<number>, count: number, start: number): void {
  let i = start;
  const byId = sim.tower.transportsById;
  for (let k = 0; k < count; k++) {
    const t = byId.get(v[i]);
    const cars = v[i + 1];
    i += 2;
    if (t) {
      let anyLoad = false;
      for (let c = 0; c < cars; c++) if (v[i + 3 * c + 1] >= 0) anyLoad = true;
      t.carPositions.length = cars;
      t.carDir.length = cars;
      const load = anyLoad ? (t.carLoad ?? []) : null;
      if (load) load.length = cars;
      for (let c = 0; c < cars; c++) {
        t.carPositions[c] = v[i + 3 * c];
        if (load) load[c] = v[i + 3 * c + 1];
        t.carDir[c] = v[i + 3 * c + 2];
      }
      if (load) t.carLoad = load;
      else delete t.carLoad;
    }
    i += 3 * cars;
  }
}

/**
 * Append the engine's log entries since the last sync to the read model's
 * log, replacing the `own` lines the instance logged itself since then (the
 * commands it ran, which the engine logged too, in the order the engine ran
 * them among its steps). The default host drops the first `own` engine
 * entries instead, which is right only when every command came before the
 * steps since the last sync; a host that syncs once per frame or per worker
 * reply sees steps and commands interleaved, so it takes the engine's order.
 * `logSeq` grows by the entries that are new to the read model.
 */
export function appendEngineLog(sim: Simulation, entries: readonly LogEntry[], own: number): void {
  const drop = Math.min(own, sim.log.length);
  sim.log.length -= drop;
  for (const e of entries) sim.log.push({ minute: e.minute, text: e.text, kind: e.kind });
  while (sim.log.length > LOG_RING_CAP) sim.log.shift();
  sim.logSeq += Math.max(0, entries.length - own);
}
