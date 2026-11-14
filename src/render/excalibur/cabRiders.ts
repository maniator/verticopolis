import type { PersonView, TransportView } from "../../simport/view";
import { ridingHidden } from "./crowdFigure";

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
 */

/** Boarded riders by shaft id, then by car index. */
export type CabRiders = Map<number, number[]>;

/** Shafts by the x of their middle, reused by every count: shafts stacked in
 *  one column share it. A column no shaft stands in any more keeps an empty
 *  list, which finds nobody. */
const columns = new Map<number, TransportView[]>();

/** The car of `t` nearest floor `fy`, and how far it is. */
function nearestCar(t: TransportView, fy: number): { car: number; gap: number } {
  let car = 0;
  for (let i = 1; i < t.carPositions.length; i++) {
    if (Math.abs(t.carPositions[i] - fy) < Math.abs(t.carPositions[car] - fy)) car = i;
  }
  return { car, gap: Math.abs(t.carPositions[car] - fy) };
}

/** Count the riders aboard every car into `out`, reusing its arrays. One pass
 *  over the people after one over the shafts: callers run it once per sim
 *  step, never per car or per frame. */
export function countCabRiders(
  people: ReadonlyArray<PersonView>,
  transports: ReadonlyArray<TransportView>,
  out: CabRiders,
): CabRiders {
  for (const counts of out.values()) counts.fill(0);
  for (const column of columns.values()) column.length = 0;
  for (const t of transports) {
    if (!Array.isArray(t.carPositions) || t.carPositions.length === 0) continue;
    const mid = t.x + t.width / 2;
    const column = columns.get(mid);
    if (column) column.push(t);
    else columns.set(mid, [t]);
    const counts = out.get(t.id);
    if (!counts || counts.length !== t.carPositions.length) out.set(t.id, new Array<number>(t.carPositions.length).fill(0));
  }
  for (const p of people) {
    if (!ridingHidden(p)) continue;
    const column = columns.get(p.x);
    if (!column) continue;
    // Two stacked shafts can share their end floor (a sky lobby), so a rider
    // there belongs to the shaft whose car stands nearest them.
    let best: { t: TransportView; car: number; gap: number } | undefined;
    for (const t of column) {
      if (p.fy < t.bottom || p.fy > t.top) continue;
      const { car, gap } = nearestCar(t, p.fy);
      if (!best || gap < best.gap) best = { t, car, gap };
    }
    if (!best) continue;
    const counts = out.get(best.t.id);
    if (counts) counts[best.car]++;
  }
  return out;
}

/** Riders aboard car `car` of shaft `shaft`, 0 when none are counted. */
export function ridersAboard(counts: CabRiders, shaft: number, car: number): number {
  return counts.get(shaft)?.[car] ?? 0;
}

/** The counts per drawn tower, kept with the crowd they were counted from. */
const counted = new WeakMap<CabSource, { people: unknown; counts: CabRiders }>();

/** The riders aboard every car this frame: recounted when a sim step lands
 *  (`stepped`) or the crowd itself was replaced, and reused on the frames
 *  between, when nobody can board or leave. */
export function cabRidersOf(engine: CabSource, stepped: boolean): CabRiders {
  const people = engine.sim.crowd.people;
  let c = counted.get(engine);
  if (!c) counted.set(engine, (c = { people: undefined, counts: new Map() }));
  if (stepped || c.people !== people) countCabRiders(people ?? [], engine.sim.tower.transports ?? [], c.counts);
  c.people = people;
  return c.counts;
}
