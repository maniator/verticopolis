import type { BombSearchGuard } from "../../simport/view";
import { TILE } from "../scale";
import { ESCAPE_W } from "../sprites/structure/rooftop";

/** How far left of a run's first tile a climbing guard stands, in tiles:
 *  the middle of the fire escape hung off that side of the floor. */
export const ON_THE_ESCAPE = ESCAPE_W / 2 / TILE;

/** Where a guard is at minute `now`: on the emergency stairs until
 *  `arrive`, then walking the rooms left to right until `done`. On the
 *  stairs it follows the engine's `route` corner to corner, so a guard
 *  crossing to another tower walks to a floor they share and over instead
 *  of climbing through the sky between them. The stairs time is split by
 *  floors; crossing a shared floor takes none. `floor` may be fractional on
 *  the stairs, where `x` is on the fire escape left of the route's stairs
 *  tile; `x` is in tiles. */
export function guardPosition(g: BombSearchGuard, now: number): { floor: number; x: number; climbing: boolean } {
  const part = (a: number, b: number): number => (b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 1);
  if (now < g.arrive) {
    const route = g.route.length > 1 ? g.route : [[g.from, g.left] as const, [g.floor, g.left] as const];
    let floors = 0;
    for (let i = 1; i < route.length; i++) floors += Math.abs(route[i]![0] - route[i - 1]![0]);
    let along = part(g.start, g.arrive) * floors;
    for (let i = 1; i < route.length; i++) {
      const [f0, x] = route[i - 1]!;
      const leg = Math.abs(route[i]![0] - f0);
      if (along < leg || i === route.length - 1) {
        const floor = f0 + Math.sign(route[i]![0] - f0) * Math.min(along, leg);
        return { floor, x: x - ON_THE_ESCAPE, climbing: true };
      }
      along -= leg;
    }
  }
  return { floor: g.floor, x: g.left + (g.right - g.left) * part(g.arrive, g.done), climbing: false };
}
