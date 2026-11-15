import type { PersonView, TransportView } from "../../simport/view";
import { CAST } from "../pixelSprites/people";
import { ridingHidden } from "./crowdFigure";
import { figureKey, IMPATIENT_SHARE } from "./crowdLook";

/** What `cabRidersOf` reads of the drawn tower. */
export interface CabSource {
  readonly sim: { readonly crowd: { readonly people: ReadonlyArray<PersonView> }; readonly tower: { readonly transports: ReadonlyArray<TransportView> } };
}

/**
 * Who stands inside each elevator cab. The cab draws one figure for each
 * person the crowd hides while they ride: the people who walked into the
 * car from its line and walk off at their floor. The engine's car load is a
 * different number, the traffic model's head count, which boards from a
 * tally, falls by part at each stop and resets when the car parks, so it is
 * never drawn as people (3.7.3).
 *
 * A rider stands at the middle of their shaft at their car's floor (the
 * engine's `Riding` step), so a rider belongs to the shaft whose middle they
 * stand at and whose span holds them, in the car nearest their floor.
 *
 * Each rider is drawn as themselves: the cab stands up the figure the crowd
 * draws for that person on foot (their look from their seed, the mood of
 * their wait, Modern's shading), so nobody changes clothes in the car.
 */

/** The riders aboard one car. */
export interface CabLoad {
  /** How many ride. */
  count: number;
  /** Each rider's standing figure (`figureKey`), in the crowd's order: the
   *  first `count` entries. The array keeps its length between counts, so a
   *  count writes over it instead of growing it again. */
  figures: number[];
  /** The figures as one string, rebuilt only when the riders change. */
  cast: string;
  /** The last count's figures and how many, to tell whether `cast` is
   *  still right. */
  prev: number[];
  prevCount: number;
}

/** Boarded riders by shaft id, then by car index. */
export type CabRiders = Map<number, CabLoad[]>;

/** What a rider's figure reads beyond the person: the catalog's fed-up line
 *  (the mood) and whether Modern shades the figures. */
export interface RiderLook {
  readonly fedUpWait: number;
  readonly lit: boolean;
}

const EMPTY_LOAD: CabLoad = newLoad();

function newLoad(): CabLoad {
  return { count: 0, figures: [], cast: "", prev: [], prevCount: 0 };
}

/** The figures of a car's riders, as a new array (on a change only). */
export function loadFigures(load: CabLoad): number[] {
  return load.figures.slice(0, load.count);
}

/** A figure key grows by the same step per look, so a rider's key is their
 *  look times that step plus a part that depends only on the mood and the
 *  shading, worked out once here instead of per rider per step: content,
 *  impatient and fed up, each flat then shaded. */
const LOOK_STEP = figureKey(1, "stand", 1, "content", false, false) - figureKey(0, "stand", 1, "content", false, false);
const STAND: readonly number[] = (["content", "impatient", "fedUp"] as const).flatMap((m) => [figureKey(0, "stand", 1, m, false, false), figureKey(0, "stand", 1, m, false, true)]);
const STAND_FED_UP = 4;
const STAND_IMPATIENT = 2;
const STAND_CONTENT = 0;
const STAND_LIT = 1;

/** The figure a hidden rider stands as in the cab: the crowd's own look for
 *  them (`personFigure`: `castIndex` of their seed, `waitMood` of their
 *  wait), standing still and facing into the car. Written out here because it
 *  runs for every rider on every step. */
export function riderFigure(p: PersonView, look: RiderLook): number {
  const wait = p.wait;
  let stand = STAND_CONTENT;
  if (wait > look.fedUpWait) stand = STAND_FED_UP;
  else if (wait > look.fedUpWait * IMPATIENT_SHARE) stand = STAND_IMPATIENT;
  if (look.lit) stand += STAND_LIT;
  const seed = p.seed < 0 ? -p.seed : p.seed;
  return (seed % CAST.length) * LOOK_STEP + STAND[stand];
}

function sameAsLast(load: CabLoad): boolean {
  if (load.count !== load.prevCount) return false;
  const a = load.figures;
  const b = load.prev;
  for (let i = 0; i < load.count; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A shaft the count looks in, with its cars' loads, so a rider's car is
 *  found without a lookup by id. Kept and reused from count to count. */
interface Slot {
  t: TransportView;
  loads: CabLoad[];
}
const slots: Slot[] = [];

/** The shafts standing at the last count, so a gone shaft's cars are dropped. */
const liveShafts = new Set<number>();

/** Shafts by the x of their middle, reused by every count: shafts stacked in
 *  one column share it. A column no shaft stands in any more keeps an empty
 *  list, which finds nobody. */
const columns = new Map<number, Slot[]>();

/** The car of `t` nearest floor `fy`. Its distance is left in `nearestGap`,
 *  so the per-rider search allocates nothing. */
let nearestGap = 0;
function nearestCar(t: TransportView, fy: number): number {
  const at = t.carPositions;
  let car = 0;
  let gap = Math.abs(at[0] - fy);
  for (let i = 1; i < at.length; i++) {
    const d = Math.abs(at[i] - fy);
    if (d < gap) {
      car = i;
      gap = d;
    }
  }
  nearestGap = gap;
  return car;
}

/** Count the riders aboard every car into `out`, reusing its arrays. One pass
 *  over the people after one over the shafts, then one over the cars: callers
 *  run it once per sim step, never per car or per frame. */
export function countCabRiders(
  people: ReadonlyArray<PersonView>,
  transports: ReadonlyArray<TransportView>,
  out: CabRiders,
  look: RiderLook,
): CabRiders {
  for (const loads of out.values()) {
    for (const load of loads) {
      // The arrays swap, so the last count stays to compare against.
      const last = load.figures;
      load.figures = load.prev;
      load.prev = last;
      load.prevCount = load.count;
      load.count = 0;
    }
  }
  for (const column of columns.values()) column.length = 0;
  liveShafts.clear();
  let used = 0;
  for (const t of transports) {
    if (!Array.isArray(t.carPositions) || t.carPositions.length === 0) continue;
    liveShafts.add(t.id);
    let loads = out.get(t.id);
    if (!loads || loads.length !== t.carPositions.length) out.set(t.id, (loads = Array.from(t.carPositions, newLoad)));
    const slot = slots[used] ?? (slots[used] = { t, loads });
    used++;
    slot.t = t;
    slot.loads = loads;
    const mid = t.x + t.width / 2;
    const column = columns.get(mid);
    if (column) column.push(slot);
    else columns.set(mid, [slot]);
  }
  for (const p of people) {
    if (!ridingHidden(p)) continue;
    const column = columns.get(p.x);
    if (!column) continue;
    // Two stacked shafts can share their end floor (a sky lobby), so a rider
    // there belongs to the shaft whose car stands nearest them.
    let best: Slot | undefined;
    let bestCar = 0;
    let bestGap = 0;
    for (const slot of column) {
      const t = slot.t;
      if (p.fy < t.bottom || p.fy > t.top) continue;
      const car = nearestCar(t, p.fy);
      if (!best || nearestGap < bestGap) {
        best = slot;
        bestCar = car;
        bestGap = nearestGap;
      }
    }
    if (!best) continue;
    const load = best.loads[bestCar];
    load.figures[load.count++] = riderFigure(p, look);
  }
  // Let go of the shafts the count no longer uses.
  slots.length = used;
  for (const [id, loads] of out) {
    if (!liveShafts.has(id)) {
      out.delete(id);
      continue;
    }
    for (const load of loads) {
      if (!sameAsLast(load)) load.cast = loadFigures(load).join(",");
    }
  }
  return out;
}

/** The riders aboard car `car` of shaft `shaft`; an empty load when none are
 *  counted. */
export function cabLoad(counts: CabRiders, shaft: number, car: number): CabLoad {
  return counts.get(shaft)?.[car] ?? EMPTY_LOAD;
}

/** Riders aboard car `car` of shaft `shaft`, 0 when none are counted. */
export function ridersAboard(counts: CabRiders, shaft: number, car: number): number {
  return cabLoad(counts, shaft, car).count;
}

/** The counts per drawn tower, kept with the crowd they were counted from. */
const counted = new WeakMap<CabSource, { people: unknown; counts: CabRiders }>();

/** The riders aboard every car this frame: recounted when a sim step lands
 *  (`stepped`) or the crowd itself was replaced, and reused on the frames
 *  between, when nobody can board or leave. */
export function cabRidersOf(engine: CabSource, stepped: boolean, look: RiderLook): CabRiders {
  const people = engine.sim.crowd.people;
  let c = counted.get(engine);
  if (!c) counted.set(engine, (c = { people: undefined, counts: new Map() }));
  if (stepped || c.people !== people) countCabRiders(people ?? [], engine.sim.tower.transports ?? [], c.counts, look);
  c.people = people;
  return c.counts;
}
