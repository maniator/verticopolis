import type { Tower } from "../Tower";
import type { Unit } from "../types";
import type { Crowd } from "../Crowd";
import { METRO_DWELL_MIN, METRO_DWELL_MAX } from "./person";
import { add } from "./trips";

/**
 * The metro commuter spawners. `spawnTrips` pushes these into its per-window
 * option pool, gated on the station bin being non-empty, so a tower without a
 * metro draws the exact rng stream it always did (the golden master's fixture
 * has none). Both helpers are no-ops when the route is null, mirroring `add`'s
 * contract. (Party hall, cinema, and wedding attendance ride the separate
 * visits flow: those are round trips with a live attendance ledger, while a
 * metro trip is one-way, the train is the other half of the journey.)
 */

/** A uniformly random tile inside the unit footprint, `inset` tiles off each
 *  edge. Unit widths come from the catalog in a live game, but saves persist
 *  widths verbatim, so BOTH bounds are clamped rather than trusted: `lo` can
 *  never pass the unit's rightmost tile, and `hi` can never fall below `lo`,
 *  so a hand-edited unit narrower than the insets collapses the range onto
 *  its rightmost tile and the result always stays within
 *  `[u.x, u.x + u.width - 1]`. */
function insideX(crowd: Crowd, u: Unit, inset: number): number {
  const lo = Math.min(u.x + inset, u.x + u.width - 1);
  const hi = Math.max(lo, u.x + u.width - inset - 1);
  return crowd.rng.int(lo, hi);
}

/** One commuter stepping OFF the train: spawns mid-platform (the station's
 *  middle story, where the deck sits) and routes up into the tower. The origin
 *  x is stamped inside the station footprint because the platform story has no
 *  floor tiles for pickX to find (its fallback would strand the figure at the
 *  lot edge). If no transport reaches the platform the route is null and
 *  nothing spawns: build an elevator down to your metro. */
export function metroArrival(crowd: Crowd, tower: Tower, station: Unit, to: number): void {
  const p = add(crowd, tower, station.floor + 1, to);
  if (!p) return;
  p.x = insideX(crowd, station, 2);
}

/** One commuter heading OUT by train: routes down to the platform, strolls to
 *  a spot inside the station footprint, and waits there until their train
 *  takes them (the lingerFor expiry stands in for boarding). */
export function metroDeparture(crowd: Crowd, tower: Tower, station: Unit, from: number): void {
  const p = add(crowd, tower, from, station.floor + 1);
  if (!p) return;
  p.destX = insideX(crowd, station, 2);
  p.lingerFor = crowd.rng.int(METRO_DWELL_MIN, METRO_DWELL_MAX);
}
