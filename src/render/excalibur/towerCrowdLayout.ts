import { catalogFacility, type Catalog } from "../../catalog/catalogTypes";
import type { UnitView } from "../../simport/view";
import type { FacilityKind } from "../../shared/types";

/**
 * Pure layout math for the decorative passer-by builder in {@link buildWalkers}.
 * These helpers take plain values (no Excalibur canvas bake), so the placement
 * rules are unit-tested here on their own.
 */

/** The x-spans of the UPPER stories of every multi-floor facility (cinema,
 *  party hall, recycling, metro), keyed by floor row. Those rows still carry the
 *  facility's floor lots, but an ambient walker placed there would stand on the
 *  facility's mid-line and float above its real floor, so `buildWalkers` drops
 *  these lots from its runs. */
export function coveredUpperStories(units: readonly UnitView[], catalog: Catalog): Map<number, Array<[number, number]>> {
  const rows = new Map<number, Array<[number, number]>>();
  for (const u of units) {
    const span = catalogFacility(catalog, u.kind).floors;
    if (span <= 1) continue;
    for (let k = 1; k < span; k++) {
      const row = u.floor + k;
      let spans = rows.get(row);
      if (!spans) rows.set(row, (spans = []));
      spans.push([u.x, u.x + u.width]);
    }
  }
  return rows;
}

/** True if lot `x` on `floor` sits inside a covered upper-story span (the
 *  half-open `[a, b)` of a multi-floor facility), so `buildWalkers` skips it. */
export function lotCovered(rows: Map<number, Array<[number, number]>>, floor: number, x: number): boolean {
  const spans = rows.get(floor);
  if (!spans) return false;
  for (const [a, b] of spans) if (x >= a && x < b) return true;
  return false;
}

/** How many tiles either side of an elevator shaft stay clear of decorative
 *  passers-by on every floor it serves: the landing, where the engine's
 *  waiting riders queue (#2091). About six riders at the engine's queue
 *  spacing. */
export const ELEVATOR_LANDING_TILES = 6;
/** Tiles either side of a stair or escalator footprint that stay clear. */
export const FLIGHT_LANDING_TILES = 1;
/** Tiles either side of a shop, restaurant or other commercial room that stay
 *  clear: its front, where customers come and go. */
export const SHOP_FRONT_TILES = 2;

interface TrafficTransport {
  readonly kind: FacilityKind;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
}

/** The lots, keyed by floor, where a player reads real traffic: every elevator
 *  landing, stair and escalator landing, and commercial front (#2091). A
 *  decorative passer-by must never stand on one, since it would look like a
 *  person the engine knows about, waiting where real queues form. */
export function trafficLots(
  transports: readonly TrafficTransport[],
  units: readonly UnitView[],
  catalog: Catalog,
): Map<number, Set<number>> {
  const lots = new Map<number, Set<number>>();
  const keep = (floor: number, x0: number, x1: number) => {
    let row = lots.get(floor);
    if (!row) lots.set(floor, (row = new Set()));
    for (let x = x0; x <= x1; x++) row.add(x);
  };
  for (const t of transports) {
    // An elevator is the transport with cars (the same test as isElevatorKind).
    const margin = catalogFacility(catalog, t.kind).maxCars !== null ? ELEVATOR_LANDING_TILES : FLIGHT_LANDING_TILES;
    for (let f = t.bottom; f <= t.top; f++) keep(f, t.x - margin, t.x + t.width - 1 + margin);
  }
  for (const u of units) {
    if (catalogFacility(catalog, u.kind).commercial) keep(u.floor, u.x - SHOP_FRONT_TILES, u.x + u.width - 1 + SHOP_FRONT_TILES);
  }
  return lots;
}
