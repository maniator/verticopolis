import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { geoVariant, type RoomCtx } from "./common";
import { drawCinema, drawFastFood, drawRestaurant } from "./food.interiors";
import { FASTFOOD_DEFAULT, FASTFOOD_LOOKS, RESTAURANT_DEFAULT, RESTAURANT_LOOKS } from "./food.looks";

/**
 * Food and entertainment room art: fast food, restaurant, and cinema. Each KIND
 * keeps one anchor shape (the fast-food sign band, the restaurant's dark dining
 * room), and the subtype furnishes the rest, so each of the five fast foods and
 * five restaurants reads as its own room. The look tables live in `food.looks`
 * and the interior draw bodies in `food.interiors`; these thin dispatchers pick
 * the look, count the real occupants, and hand off. An undefined or unknown
 * subtype falls back to the `_DEFAULT` look, no throw.
 *
 * Occupancy is honest: figures fill in seed order up to `visibleOccupants(u)`
 * (driven by `occupants` / `outForMeal`), the look by `subtype`, and each
 * figure's variety by a stable geography seed (`floor`, `x`). All are fixed for
 * a placed unit, so the room stays cacheable, an empty venue reads empty, a
 * full one full, and a TDT id renumber does not reshuffle the crowd.
 */

// The canon look tables live in `food.looks.ts` (split out for file-size
// headroom). Re-exported here so the `pixelSprites.ts` barrel and
// `subtypeVisuals` keep importing them from `./food` unchanged.
export { FASTFOOD_LOOKS, RESTAURANT_LOOKS };
export type { FastFoodLook, RestaurantLook } from "./food.looks";

/** A stable per-room shirt seed from GEOGRAPHY (floor, x), so the crowd's colors
 *  survive a save, export, and TDT import (which renumbers `u.id`). Each seat
 *  index adds to it, giving per-occupant variety within the room. */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

export function fastFood(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const look = (u.subtype !== undefined && FASTFOOD_LOOKS[u.subtype]) || FASTFOOD_DEFAULT;
  drawFastFood(d.ctx, x, y, w, h, look, visibleOccupants(u), figureSeed(u));
}

export function restaurant(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const look = (u.subtype !== undefined && RESTAURANT_LOOKS[u.subtype]) || RESTAURANT_DEFAULT;
  drawRestaurant(d.ctx, x, y, w, h, look, d.lit, visibleOccupants(u), figureSeed(u));
}

export function cinema(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  // Two cinemas on different footprints must not screen the identical crowd or
  // marquee color: axis 4 varies the audience, axis 5 seeds the marquee phase
  // (art bible geoVariant axis map; no axis is reused within the cinema kind).
  const geoAud = geoVariant(u, 4, 997);
  const geoMar = geoVariant(u, 5, 997);
  drawCinema(d.ctx, x, y, w, h, d.anim, visibleOccupants(u), geoAud, geoMar);
}
