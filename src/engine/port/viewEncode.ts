import type { Simulation } from "../Simulation";
import type { Tower } from "../Tower";
import { roomCounts, roomSlots, roomUnits } from "../tower/rooms";
import { isStructural } from "../tower/towerTopology";
import type { Transport, Unit } from "../types";
import type { MetaLog } from "./metaLog";
import { CALENDAR_CODES, KIND_CODES, KINDS, MODE_CODES, PERSON_STATE_CODES, UNIT_STATE_CODES, VIEW_LAYOUT, WEATHER_CODES, codeOf } from "./layout";

/**
 * The engine view's arrays from the TypeScript `Simulation`: the structural
 * snapshot and the dynamic frame, slot for slot what the Rust engine writes
 * (`engine-rs/src/view/structure.rs` and `reader.rs`), so the shared reader
 * decodes either engine's arrays the same way. The golden-array test holds
 * the two encoders together on one tower.
 */

const L = VIEW_LAYOUT;
const FIELDS = 5;

/** A unit's frame fields: state, occupants, customersIn, hotelCustomersIn,
 *  outForMeal, an absent counter as -1 (`frame::unit_fields`). */
function fieldsOf(u: Unit, out: number[] | Float64Array, at: number): void {
  out[at] = codeOf(UNIT_STATE_CODES, u.state);
  out[at + 1] = u.occupants;
  out[at + 2] = u.customersIn ?? -1;
  out[at + 3] = u.hotelCustomersIn ?? -1;
  out[at + 4] = u.outForMeal ?? -1;
}

const kindCode = (kind: string): number => codeOf(KIND_CODES, kind);

/** A run of floor or lobby tiles: `count` tiles side by side from `x`. */
interface Run {
  kind: number;
  floor: number;
  x: number;
  width: number;
  count: number;
  fields: number[];
}

function sameFields(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < FIELDS; k++) if (a[k] !== b[k]) return false;
  return true;
}

/** The floor and lobby tiles as maximal runs, by floor and then x: a run
 *  ends at a gap or a change of kind, width or frame fields, the partition
 *  the Rust snapshot's runs make. */
function tileRuns(tower: Tower): Run[] {
  const tiles = tower.units.filter((u) => isStructural(u.kind));
  tiles.sort((a, b) => a.floor - b.floor || a.x - b.x);
  const runs: Run[] = [];
  let last: Run | undefined;
  for (const u of tiles) {
    const fields: number[] = [];
    fieldsOf(u, fields, 0);
    const kind = kindCode(u.kind);
    if (last && last.kind === kind && last.floor === u.floor && last.width === u.width && u.x === last.x + last.count * last.width && sameFields(last.fields, fields)) {
      last.count++;
    } else {
      last = { kind, floor: u.floor, x: u.x, width: u.width, count: 1, fields };
      runs.push(last);
    }
  }
  return runs;
}

/** The structural snapshot (`viewStructure()`): the header, every room in
 *  slot order, the tile runs and every shaft with its skipped floors. Built
 *  per tower revision. */
export function encodeStructure(sim: Simulation): Float64Array {
  const tower = sim.tower;
  const rooms = roomUnits(tower);
  const runs = tileRuns(tower);
  const skips = tower.transports.reduce((n, t) => n + (t.skipFloors?.length ?? 0), 0);
  const v = new Float64Array(L.structureWidth + rooms.length * L.roomWidth + runs.length * L.runWidth + tower.transports.length * L.shaftFixed + skips);
  const s = L.structure;
  v[s.revision] = tower.revision;
  v[s.rooms] = rooms.length;
  v[s.runs] = runs.length;
  v[s.shafts] = tower.transports.length;
  v[s.highestFloor] = tower.highestFloor;
  v[s.lowestFloor] = tower.lowestFloor;
  v[s.mode] = codeOf(MODE_CODES, sim.mode);
  v[s.calendar] = codeOf(CALENDAR_CODES, sim.modernCalendar);
  v[s.sceneSeed] = sim.rng.initialSeed;
  let at = L.structureWidth;
  for (const u of rooms) {
    v[at + L.room.id] = u.id;
    v[at + L.room.kind] = kindCode(u.kind);
    v[at + L.room.floor] = u.floor;
    v[at + L.room.x] = u.x;
    v[at + L.room.width] = u.width;
    at += L.roomWidth;
  }
  for (const r of runs) {
    v[at + L.run.kind] = r.kind;
    v[at + L.run.floor] = r.floor;
    v[at + L.run.x] = r.x;
    v[at + L.run.width] = r.width;
    v[at + L.run.count] = r.count;
    for (let k = 0; k < FIELDS; k++) v[at + L.run.state + k] = r.fields[k];
    at += L.runWidth;
  }
  for (const t of tower.transports) {
    const skip = t.skipFloors ?? [];
    v[at + L.shaft.id] = t.id;
    v[at + L.shaft.kind] = kindCode(t.kind);
    v[at + L.shaft.x] = t.x;
    v[at + L.shaft.width] = t.width;
    v[at + L.shaft.bottom] = t.bottom;
    v[at + L.shaft.top] = t.top;
    v[at + L.shaft.cars] = t.cars;
    v[at + L.shaft.skips] = skip.length;
    at += L.shaftFixed;
    for (const f of skip) v[at++] = f;
  }
  return v;
}

/** The unlocked kinds as a bitmask by kind code, in one double: bit k is
 *  `Math.floor(mask / 2 ** k) % 2`, past JavaScript's 32-bit operators. */
function unlockedMask(sim: Simulation): number {
  let mask = 0;
  for (let k = 0; k < KINDS.length; k++) if (sim.isUnlocked(KINDS[k])) mask += 2 ** k;
  return mask;
}

const transportsLen = (ts: readonly Transport[]): number => ts.reduce((n, t) => n + L.transportFixed + L.carWidth * t.cars, 0);

/**
 * The dynamic frame (`viewFrame(full)`), with what this reader last sent:
 * every room on a full frame (asked for, the first, or after the tower, its
 * revision, its unit count or its room list moved), else the rooms whose
 * fields changed. The room list moves on its own when a writer drops it
 * (`forgetUnitLists`) without moving the revision, as the WASM mirror host's
 * merge does when the engine's units differ from the held ones; its slots
 * may then name other rooms, so only a full frame is safe.
 * A frame that is not full compares only the rooms marked since the last
 * frame (`mark`, from `markRoom` through `watchRooms`) with what it last
 * sent, in slot order, so it costs the rooms written, not every room
 * (#1389).
 */
export class FrameEncoder {
  private tower: Tower | undefined;
  private rooms: readonly Unit[] | undefined;
  private revision = -1;
  private units = -1;
  private last = new Float64Array(0);
  private seq = 0;
  /** The units marked since the last frame. */
  private readonly marked = new Set<Unit>();
  /** One room's fields, the scratch `send` compares from. */
  private readonly now = [0, 0, 0, 0, 0];

  /** Note the units written since the last call, for the next frame. */
  mark(units: Iterable<Unit>): void {
    for (const u of units) this.marked.add(u);
  }

  /** The frame for `sim`; `meta` gives the header's meta revision. */
  frame(sim: Simulation, askFull: boolean, meta: MetaLog): Float64Array {
    const tower = sim.tower;
    const rooms = roomUnits(tower);
    const full = askFull || tower !== this.tower || rooms !== this.rooms || tower.revision !== this.revision || tower.units.length !== this.units || this.last.length !== rooms.length * FIELDS;
    const changed: number[] = [];
    if (full) {
      this.last = new Float64Array(rooms.length * FIELDS);
      for (let slot = 0; slot < rooms.length; slot++) this.send(slot, rooms[slot], true, changed);
    } else if (this.marked.size > 0) {
      const at = roomSlots(tower);
      const slots: number[] = [];
      for (const u of this.marked) {
        const slot = at.get(u);
        if (slot !== undefined) slots.push(slot);
      }
      if (slots.length > 1) slots.sort((a, b) => a - b);
      for (const slot of slots) this.send(slot, rooms[slot], false, changed);
    }
    this.marked.clear();
    this.tower = tower;
    this.rooms = rooms;
    this.revision = tower.revision;
    this.units = tower.units.length;
    this.seq++;
    const people = sim.crowd.people;
    const v = new Float64Array(L.headerWidth + people.length * L.personWidth + changed.length + transportsLen(tower.transports));
    const h = L.header;
    const counts = sim.events.counts;
    v[h.minutes] = sim.clock.minutes;
    v[h.towerRevision] = tower.revision;
    v[h.metaRevision] = meta.revision;
    v[h.mealOverlayRevision] = tower.mealOverlayRevision;
    v[h.logSeq] = sim.logSeq;
    v[h.money] = sim.money;
    v[h.star] = sim.star;
    v[h.unlocked] = unlockedMask(sim);
    // The population counter the engine keeps as rooms change (HP-8).
    v[h.population] = roomCounts(tower).population;
    v[h.weather] = codeOf(WEATHER_CODES, sim.weather);
    v[h.santaFxSeq] = sim.santaFxSeq;
    v[h.explosionFxSeq] = sim.explosionFx.seq;
    v[h.explosionFxFloor] = sim.explosionFx.floor;
    v[h.explosionFxX] = sim.explosionFx.x;
    v[h.thiefFxSeq] = sim.thiefFx.seq;
    v[h.thiefFxCaught] = sim.thiefFx.caught ? 1 : 0;
    v[h.thiefFxFloor] = sim.thiefFx.floor;
    v[h.treasureFxSeq] = sim.treasureFx.seq;
    v[h.treasureFxFloor] = sim.treasureFx.floor;
    v[h.treasureFxX] = sim.treasureFx.x;
    v[h.vipFxSeq] = sim.vipFxSeq;
    v[h.firesStarted] = counts.fires;
    v[h.firesGutRooms] = counts.firesGutRooms;
    v[h.bombsDetonated] = counts.bombs;
    v[h.pendingChoice] = sim.pendingChoice === null ? 0 : 1;
    v[h.onHourRuns] = sim.onHourRuns;
    v[h.rooms] = rooms.length;
    v[h.full] = full ? 1 : 0;
    v[h.frameSeq] = this.seq;
    v[h.people] = people.length;
    v[h.units] = changed.length / L.unitWidth;
    v[h.transports] = tower.transports.length;
    let at = L.headerWidth;
    const p = L.person;
    for (const person of people) {
      v[at + p.id] = person.id;
      v[at + p.seed] = person.seed;
      v[at + p.staff] = person.staff === true ? 1 : 0;
      v[at + p.state] = codeOf(PERSON_STATE_CODES, person.state);
      v[at + p.floor] = person.floor;
      v[at + p.x] = person.x;
      v[at + p.fy] = person.fy;
      v[at + p.wait] = person.wait;
      at += L.personWidth;
    }
    v.set(changed, at);
    at += changed.length;
    for (const t of tower.transports) {
      v[at + L.transport.id] = t.id;
      v[at + L.transport.cars] = t.cars;
      at += L.transportFixed;
      for (let i = 0; i < t.cars; i++) {
        v[at + L.car.position] = t.carPositions[i] ?? 0;
        v[at + L.car.load] = t.carLoad?.[i] ?? -1;
        v[at + L.car.direction] = t.carDir[i] ?? 0;
        at += L.carWidth;
      }
    }
    return v;
  }
  /** Push the room in `slot` onto `changed` when its fields moved since the
   *  last frame (or always, on a full frame), and keep them as sent. */
  private send(slot: number, u: Unit, full: boolean, changed: number[]): void {
    const at = slot * FIELDS;
    fieldsOf(u, this.now, 0);
    let moved = full;
    for (let k = 0; k < FIELDS && !moved; k++) moved = this.now[k] !== this.last[at + k];
    if (!moved) return;
    for (let k = 0; k < FIELDS; k++) this.last[at + k] = this.now[k];
    changed.push(slot, this.now[0], this.now[1], this.now[2], this.now[3], this.now[4]);
  }
}
